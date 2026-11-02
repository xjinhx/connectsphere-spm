// Manual integration test for SCRUM-264 (logout does not clear
// csp_last_activity, so the first login attempt after a 30+ minute idle gap
// is wrongly rejected as idle). Run against the real app and local
// Supabase, not mocks, as the DoD's "manually tested against the acceptance
// criteria" step for this bug fix (fix-logout-idle-cookie branch).
//
// Run: npm run db:start (already running), dev server on APP_URL, then:
//   APP_URL=http://localhost:3264 node scripts/manual-test-scrum264.mjs
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

config({ path: resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = process.env.APP_URL ?? 'http://localhost:3264';
const TEST_PASSWORD = 'TestPass123!';
const EMAIL = 'scrum264-test@example.com';

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local.');
}
const isLocalSupabaseUrl = ['127.0.0.1', 'localhost'].includes(new URL(SUPABASE_URL).hostname);
if (!isLocalSupabaseUrl) {
  throw new Error(`NEXT_PUBLIC_SUPABASE_URL (${SUPABASE_URL}) is not local. Refusing to run against anything but 127.0.0.1/localhost.`);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function ensureTestUser() {
  const { error } = await admin.auth.admin.createUser({ email: EMAIL, password: TEST_PASSWORD, email_confirm: true });
  if (error && !error.message.toLowerCase().includes('already been registered')) {
    throw new Error(`Failed to create ${EMAIL}: ${error.message}`);
  }
}

// A persistent cookie jar standing in for the browser's cookie store across
// the whole flow: sign-in, protected requests, logout, sign-in again.
function makeJar() {
  const jar = new Map();
  return {
    header() {
      return [...jar.values()].map(({ name, value }) => `${name}=${value}`).join('; ');
    },
    mergeSetCookie(res) {
      const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const line of raw) {
        const [pair] = line.split(';');
        const eq = pair.indexOf('=');
        const name = pair.slice(0, eq);
        const value = pair.slice(eq + 1);
        const expired = /max-age=0|expires=thu, 01 jan 1970/i.test(line);
        if (expired) jar.delete(name);
        else jar.set(name, { name, value });
      }
    },
    set(name, value) {
      jar.set(name, { name, value });
    },
    has(name) {
      return jar.has(name);
    },
  };
}

async function signIn(jar, email, password) {
  const client = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll() {
        return jar.header()
          .split('; ')
          .filter(Boolean)
          .map((kv) => {
            const i = kv.indexOf('=');
            return { name: kv.slice(0, i), value: kv.slice(i + 1) };
          });
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) jar.set(name, value);
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Login failed: ${error.message}`);
}

async function hit(jar, method, path) {
  const res = await fetch(`${APP_URL}${path}`, {
    method,
    headers: { Cookie: jar.header() },
    redirect: 'manual',
  });
  jar.mergeSetCookie(res);
  return res;
}

function check(label, pass) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (!pass) process.exitCode = 1;
}

async function main() {
  await ensureTestUser();

  console.log('--- TC-264-01: logout clears csp_last_activity, so the next login succeeds on the first attempt ---');
  const jar = makeJar();
  await signIn(jar, EMAIL, TEST_PASSWORD);
  const afterLogin1 = await hit(jar, 'GET', '/api/me/permissions');
  check('first request after login 1 is not rejected', afterLogin1.status === 200);
  check('middleware set csp_last_activity after login 1', jar.has('csp_last_activity'));

  // Mirror LogoutButton: clear working-as, clear the idle marker, then sign out.
  await hit(jar, 'DELETE', '/api/me/working-as');
  const logoutRes = await hit(jar, 'DELETE', '/api/me/session');
  check('DELETE /api/me/session responds 204', logoutRes.status === 204);
  check('csp_last_activity cleared from the jar after logout', !jar.has('csp_last_activity'));

  await signIn(jar, EMAIL, TEST_PASSWORD);
  const afterLogin2 = await hit(jar, 'GET', '/api/me/permissions');
  check('first request after login 2 (post-logout) succeeds, not rejected as idle', afterLogin2.status === 200);

  console.log('\n--- TC-264-03: a genuinely idle session (no logout) is still rejected ---');
  const idleJar = makeJar();
  await signIn(idleJar, EMAIL, TEST_PASSWORD);
  await hit(idleJar, 'GET', '/api/me/permissions'); // sets a fresh csp_last_activity
  const staleTimestamp = new Date(Date.now() - 31 * 60 * 1000).toISOString();
  idleJar.set('csp_last_activity', staleTimestamp); // simulate 31 minutes of inactivity
  const idleRes = await hit(idleJar, 'GET', '/api/me/permissions');
  check('stale session (no logout) is rejected as idle', idleRes.status === 401);
}

main().then(() => {
  if (!process.exitCode) console.log('\nAll checks passed.');
});
