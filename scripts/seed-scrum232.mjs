// Local test-data setup for manually running the SCRUM-232 test cases
// (TC-232-01 to TC-232-14) from the sheet's SCRUM-232 tab.
//
// Not part of any story: this only creates accounts, a client organisation
// and submitted event requests through the real app routes (running at
// http://localhost:3000), so the assignment queue has real rows to assign
// and reassign. It does not assign/reassign anything itself - that is the
// manual step the test cases exercise.
//
// Run: npm run db:start && npm run db:reset && npm run seed:users
//      then: node scripts/seed-scrum232.mjs   (dev server must be running)
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

config({ path: resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';
const TEST_PASSWORD = 'TestPass123!';

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local.');
}

// This creates accounts with a known password (TEST_PASSWORD below) using the
// service-role key, which bypasses every policy. .env.local can point at
// either Supabase instance depending on whose machine this runs on (see
// CLAUDE.md, "Supabase — local vs. cloud"), so the URL itself - not which
// file it came from - is what's checked before anything is created.
const isLocalSupabaseUrl = ['127.0.0.1', 'localhost'].includes(new URL(SUPABASE_URL).hostname);
if (!isLocalSupabaseUrl) {
  throw new Error(
    `NEXT_PUBLIC_SUPABASE_URL (${SUPABASE_URL}) is not a local Supabase instance. ` +
      'This script creates test accounts with a known password via the service-role key - ' +
      'refusing to run against anything but 127.0.0.1/localhost. Point .env.local at `npm run db:start`\'s ' +
      'local instance before running this.',
  );
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// Accounts: seed:users already creates organiser@example.com,
// coordinator@example.com, ops-manager@example.com etc. This adds the
// combinations the SCRUM-232 test cases need beyond that.
// ---------------------------------------------------------------------------

const EXTRA_USERS = [
  { email: 'coordinator-b@example.com', roles: ['coordinator'] },
  { email: 'lead-coord@example.com', roles: ['coordinator', 'operations_manager'] },
  { email: 'coord-venue@example.com', roles: ['coordinator', 'venue_staff'] },
];

// No full_name is ever set, deliberately: nothing in the real app writes it
// (SCRUM-205 "Maintain my profile details" owns that and is still To Do), so
// every account here is left exactly as a real signed-up account would be -
// unnamed - to keep this test data honest about that gap rather than papering
// over it. The coordinator picker falls back to email when name is null
// (SCRUM-232, see domain/assignment/service.ts); that fallback is what these
// accounts exercise.

async function findUserIdByEmail(email) {
  const { data, error } = await admin.auth.admin.listUsers();
  if (error) throw error;
  return data.users.find((user) => user.email === email)?.id;
}

async function ensureUser(email, roles) {
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });

  let userId = created?.user?.id;
  if (createError) {
    if (!createError.message.toLowerCase().includes('already been registered')) {
      throw new Error(`Failed to create ${email}: ${createError.message}`);
    }
    userId = await findUserIdByEmail(email);
  }

  const { error: rolesError } = await admin.from('profiles').update({ roles }).eq('id', userId);
  if (rolesError) throw new Error(`Failed to set roles for ${email}: ${rolesError.message}`);

  console.log(`Ready: ${email} / ${TEST_PASSWORD} (${roles.join(', ')})`);
  return userId;
}

// ---------------------------------------------------------------------------
// Sign in as a given user and return a Cookie header for use against the
// Next.js dev server, built with the real @supabase/ssr serialisation so the
// app's own cookie-reading code accepts it without any special-casing.
// ---------------------------------------------------------------------------

async function cookieHeaderFor(email, password) {
  const jar = new Map();
  const client = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll() {
        return [...jar.values()];
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) jar.set(name, { name, value });
      },
    },
  });

  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Login failed for ${email}: ${error.message}`);

  return [...jar.values()].map(({ name, value }) => `${name}=${value}`).join('; ');
}

// Supabase local has refresh-token rotation on (supabase/config.toml), so the
// Next.js middleware can rotate the session on any request and send back a
// new sb-*-auth-token cookie. A session object below is a mutable holder so
// every call after a rotation uses the new cookie, the way a real browser
// would - a single captured-once cookie string goes stale after one rotation
// and every later call 307s to /login instead of reaching the route.
function session(initialCookie) {
  return { cookie: initialCookie };
}

async function api(session, method, path, body) {
  const res = await fetch(`${APP_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: session.cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length > 0) {
    const jar = new Map(session.cookie.split('; ').filter(Boolean).map((pair) => {
      const i = pair.indexOf('=');
      return [pair.slice(0, i), pair.slice(i + 1)];
    }));
    for (const line of setCookie) {
      const pair = line.split(';', 1)[0];
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    session.cookie = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${method} ${path} -> ${res.status}: non-JSON response (likely a redirect to /login - the session went stale)`);
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function main() {
  for (const { email, roles } of EXTRA_USERS) {
    await ensureUser(email, roles);
  }

  const organiserId = await findUserIdByEmail('organiser@example.com');
  if (!organiserId) {
    throw new Error('organiser@example.com not found - run `npm run seed:users` first.');
  }

  // --- Client organisation + linking the organiser (both need a Coordinator) ---
  const coordinatorSession = session(await cookieHeaderFor('coordinator@example.com', TEST_PASSWORD));

  let org;
  try {
    const created = await api(coordinatorSession, 'POST', '/api/organisations', {
      name: 'S232 Client',
      contactName: 'Priya Nair',
      contactEmail: 's232-client@example.com',
      contactPhone: '+65 9123 4567',
    });
    org = created.organisation;
    console.log(`Created client organisation: S232 Client (${org.id})`);
  } catch (error) {
    if (!String(error.message).includes('409')) throw error;
    const { organisations } = await api(coordinatorSession, 'GET', '/api/organisations');
    org = organisations.find((o) => o.name === 'S232 Client');
    console.log(`Client organisation already exists: S232 Client (${org.id})`);
  }

  await api(coordinatorSession, 'PUT', `/api/accounts/${organiserId}/organisation`, {
    clientOrganisationId: org.id,
  });
  console.log(`Linked organiser@example.com to S232 Client`);

  // --- Event requests, as the organiser ---
  const organiserSession = session(await cookieHeaderFor('organiser@example.com', TEST_PASSWORD));

  async function createAndSubmit({ name, proposedDate, startTime, endTime, expectedAttendance }) {
    const created = await api(organiserSession, 'POST', '/api/event-requests', {
      name,
      purpose: `${name} — purpose for SCRUM-232 manual testing`,
      description: `${name} is seeded test data for the SCRUM-232 unassigned queue test cases.`,
      proposedDate,
      startTime,
      endTime,
      expectedAttendance,
    });
    const submitted = await api(organiserSession, 'POST', `/api/event-requests/${created.id}/submit`, undefined);
    console.log(`Submitted: ${name} (${submitted.reference}, id ${submitted.id})`);
    return submitted;
  }

  const gala = await createAndSubmit({
    name: 'S232 Gala',
    proposedDate: '2026-11-20',
    startTime: '09:00',
    endTime: '11:00',
    expectedAttendance: 120,
  });

  const gala2 = await createAndSubmit({
    name: 'S232 Gala2',
    proposedDate: '2026-11-21',
    startTime: '10:00',
    endTime: '12:00',
    expectedAttendance: 80,
  });

  const gala3 = await createAndSubmit({
    name: 'S232 Gala3',
    proposedDate: '2026-11-22',
    startTime: '14:00',
    endTime: '16:00',
    expectedAttendance: 200,
  });

  // S232 Gala4 - stays unassigned, for TC-232-18 (the Lead-also-Coordinator
  // account must assign before it can act).
  const gala4 = await createAndSubmit({
    name: 'S232 Gala4',
    proposedDate: '2026-11-23',
    startTime: '09:00',
    endTime: '11:00',
    expectedAttendance: 60,
  });

  // S232 Gala5/Gala6 - created unassigned, then assigned to Coordinator A
  // below: TC-232-20's precondition is "already assigned", the test itself is
  // clarify/approve/reject, not the assignment.
  const gala5 = await createAndSubmit({
    name: 'S232 Gala5',
    proposedDate: '2026-11-24',
    startTime: '09:00',
    endTime: '11:00',
    expectedAttendance: 60,
  });
  const gala6 = await createAndSubmit({
    name: 'S232 Gala6',
    proposedDate: '2026-11-25',
    startTime: '09:00',
    endTime: '11:00',
    expectedAttendance: 60,
  });

  // Draft, intentionally not submitted - TC-232-05 ("a draft is not in the
  // unassigned queue").
  await api(organiserSession, 'POST', '/api/event-requests/draft', {
    name: 'S232 Draft',
  });
  console.log('Saved draft: S232 Draft (not submitted)');

  // --- Pre-assign Gala5/Gala6 to Coordinator A for TC-232-20's precondition ---
  const coordinatorAId = await findUserIdByEmail('coordinator@example.com');
  const leadSession = session(await cookieHeaderFor('ops-manager@example.com', TEST_PASSWORD));
  await api(leadSession, 'POST', `/api/event-requests/${gala5.id}/coordinator`, {
    coordinatorId: coordinatorAId,
  });
  await api(leadSession, 'POST', `/api/event-requests/${gala6.id}/coordinator`, {
    coordinatorId: coordinatorAId,
  });
  console.log('Assigned S232 Gala5 and S232 Gala6 to Coordinator A (TC-232-20 precondition)');

  console.log(`\nDone. Log in at ${APP_URL}/login with password TestPass123! as:`);
  console.log('  ops-manager@example.com   - the Lead (operations_manager)');
  console.log('  coordinator@example.com   - Coordinator A');
  console.log('  coordinator-b@example.com - Coordinator B');
  console.log('  lead-coord@example.com    - coordinator + operations_manager (TC-03, TC-18)');
  console.log('  coord-venue@example.com   - coordinator + venue_staff (TC-14)');
  console.log('  organiser@example.com     - linked to S232 Client');

  // Direct links, because an already-assigned event has no link pointing to
  // it from /assignment-queue (it is only listed there while unassigned) -
  // these ids change every reseed, so print them instead of hunting in Studio.
  console.log('\nDirect links (ids change on every reseed):');
  console.log(`  S232 Gala:  ${APP_URL}/assignment-queue/${gala.id}`);
  console.log(`  S232 Gala2: ${APP_URL}/assignment-queue/${gala2.id}`);
  console.log(`  S232 Gala3: ${APP_URL}/assignment-queue/${gala3.id}  (review: ${APP_URL}/events/${gala3.id}/review)`);
  console.log(`  S232 Gala4: ${APP_URL}/assignment-queue/${gala4.id}`);
  console.log(`  S232 Gala5: ${APP_URL}/events/${gala5.id}/review`);
  console.log(`  S232 Gala6: ${APP_URL}/events/${gala6.id}/review`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
