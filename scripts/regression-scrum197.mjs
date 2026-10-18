// Manual-test data and assertions for SCRUM-197 (TC-197-01 to 05), run against
// a freshly reset `main` + this branch's migration. Not part of any story.
//
// Exercises, through the real app routes:
//   AC1 - submitting a request notifies every Event Coordinator Lead
//         (coordinator+operations_manager accounts count too - TC-197-02)
//   AC2 - assigning a coordinator notifies them, no accept/decline offered
//         (re-checks SCRUM-94's existing behaviour, not new in this branch)
//   AC3 - reassigning notifies both the previous and the new coordinator
//
// Requires: ops-manager@example.com, coordinator@example.com (seed:users) and
// lead-coord@example.com, coordinator-b@example.com (seed-scrum232.mjs).
//
// Run: npm run db:start && npm run db:reset && npm run seed:users
//      node scripts/seed-scrum232.mjs   (dev server must be running)
//      node scripts/regression-scrum197.mjs
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

const isLocalSupabaseUrl = ['127.0.0.1', 'localhost'].includes(new URL(SUPABASE_URL).hostname);
if (!isLocalSupabaseUrl) {
  throw new Error(
    `NEXT_PUBLIC_SUPABASE_URL (${SUPABASE_URL}) is not a local Supabase instance. Refusing to run against anything but 127.0.0.1/localhost.`,
  );
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function findUserIdByEmail(email) {
  const { data, error } = await admin.auth.admin.listUsers();
  if (error) throw error;
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error(`${email} not found - run seed:users and scripts/seed-scrum232.mjs first.`);
  return user.id;
}

function session(initialCookie) {
  return { cookie: initialCookie };
}

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

async function api(sess, method, path, body) {
  const res = await fetch(`${APP_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: sess.cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length > 0) {
    const jar = new Map(sess.cookie.split('; ').filter(Boolean).map((pair) => {
      const i = pair.indexOf('=');
      return [pair.slice(0, i), pair.slice(i + 1)];
    }));
    for (const line of setCookie) {
      const pair = line.split(';', 1)[0];
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    sess.cookie = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${method} ${path} -> ${res.status}: non-JSON response (likely a redirect to /login)`);
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function notificationsFor(recipientId, eventRequestId) {
  const { data, error } = await admin
    .from('notifications')
    .select('type, message, created_at')
    .eq('recipient_id', recipientId)
    .eq('event_request_id', eventRequestId);
  if (error) throw error;
  return data;
}

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  PASS: ${message}`);
}

async function main() {
  const organiserId = await findUserIdByEmail('organiser@example.com');
  const opsManagerId = await findUserIdByEmail('ops-manager@example.com');
  const leadCoordId = await findUserIdByEmail('lead-coord@example.com'); // coordinator + operations_manager
  const coordinatorAId = await findUserIdByEmail('coordinator@example.com');
  const coordinatorBId = await findUserIdByEmail('coordinator-b@example.com');

  const organiserSession = session(await cookieHeaderFor('organiser@example.com', TEST_PASSWORD));
  const leadSession = session(await cookieHeaderFor('ops-manager@example.com', TEST_PASSWORD));

  // --- AC1: TC-197-01, TC-197-02 -------------------------------------------
  console.log('\nAC1 - every Event Coordinator Lead is notified on submission');
  const created = await api(organiserSession, 'POST', '/api/event-requests', {
    name: 'S197 Submission Demo',
    purpose: 'S197 Submission Demo — purpose for SCRUM-197 manual testing',
    description: 'S197 Submission Demo is seeded test data for the SCRUM-197 notification test cases.',
    proposedDate: '2026-12-01',
    startTime: '09:00',
    endTime: '11:00',
    expectedAttendance: 50,
  });
  const submitted = await api(organiserSession, 'POST', `/api/event-requests/${created.id}/submit`, undefined);
  console.log(`  Submitted ${submitted.reference} (${created.id})`);

  const opsManagerNotifs = await notificationsFor(opsManagerId, created.id);
  assert(
    opsManagerNotifs.some((n) => n.type === 'request_submitted'),
    'TC-197-01: ops-manager@example.com (operations_manager only) received a request_submitted notification',
  );

  const leadCoordNotifs = await notificationsFor(leadCoordId, created.id);
  assert(
    leadCoordNotifs.some((n) => n.type === 'request_submitted'),
    'TC-197-02: lead-coord@example.com (coordinator + operations_manager) also received one — holding the Lead role among others still counts',
  );

  const coordinatorANotifsBeforeAssign = await notificationsFor(coordinatorAId, created.id);
  assert(
    coordinatorANotifsBeforeAssign.length === 0,
    'TC-197-01: coordinator@example.com (plain coordinator, not a Lead) received nothing for the submission itself',
  );

  // --- AC2: TC-197-03 --------------------------------------------------------
  console.log('\nAC2 - the assigned coordinator is notified, identifying the event');
  await api(leadSession, 'POST', `/api/event-requests/${created.id}/coordinator`, { coordinatorId: coordinatorAId });
  const coordinatorANotifsAfterAssign = await notificationsFor(coordinatorAId, created.id);
  const assignedNotif = coordinatorANotifsAfterAssign.find((n) => n.type === 'coordinator_assigned');
  assert(!!assignedNotif, 'TC-197-03: coordinator@example.com received a coordinator_assigned notification');
  assert(
    assignedNotif.message.includes(submitted.reference),
    'TC-197-03: the notification message identifies the event by reference',
  );

  // --- AC3: TC-197-04, TC-197-05 ----------------------------------------------
  console.log('\nAC3 - reassignment notifies both the previous and the new coordinator');
  await api(leadSession, 'PATCH', `/api/event-requests/${created.id}/coordinator`, {
    coordinatorId: coordinatorBId,
    fromCoordinatorId: coordinatorAId,
  });

  const coordinatorANotifsAfterReassign = await notificationsFor(coordinatorAId, created.id);
  assert(
    coordinatorANotifsAfterReassign.some((n) => n.type === 'coordinator_unassigned'),
    'TC-197-04: coordinator@example.com (previous coordinator) received a coordinator_unassigned notification',
  );

  const coordinatorBNotifs = await notificationsFor(coordinatorBId, created.id);
  assert(
    coordinatorBNotifs.some((n) => n.type === 'coordinator_assigned'),
    'TC-197-05: coordinator-b@example.com (new coordinator) received a coordinator_assigned notification',
  );

  console.log('\nAll SCRUM-197 assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
