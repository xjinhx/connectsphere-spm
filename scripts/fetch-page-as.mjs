// Manual-test helper: fetches a page as a given seeded test user, for SCRUM-236
// regression evidence. Run: node scripts/fetch-page-as.mjs <email> <path>
import { config } from 'dotenv';
import { resolve } from 'path';
import { createServerClient } from '@supabase/ssr';

config({ path: resolve(process.cwd(), '.env.local') });
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const APP_URL = 'http://localhost:3000';

async function cookieHeaderFor(email, password) {
  const jar = new Map();
  const client = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll() { return [...jar.values()]; },
      setAll(cookiesToSet) { for (const { name, value } of cookiesToSet) jar.set(name, { name, value }); },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Login failed: ${error.message}`);
  return [...jar.values()].map(({ name, value }) => `${name}=${value}`).join('; ');
}

const [, , email, path] = process.argv;
const cookie = await cookieHeaderFor(email, 'TestPass123!');
const res = await fetch(`${APP_URL}${path}`, { headers: { Cookie: cookie } });
const html = await res.text();
console.log(`STATUS ${res.status}`);
console.log(html);
