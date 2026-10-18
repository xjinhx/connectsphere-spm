// Manual-test data for SCRUM-233 (TC-233-01 to 09), run against a freshly
// reset `main`. Not part of any story.
//
// Creates:
//   - coordinator-c@example.com, coordinator-d@example.com (coordinator-b
//     already exists from seed:users if you've run it before; created here
//     too in case it hasn't) with no events, for TC-233-02
//   - S233 Demo A -> Coordinator A, Submitted (TC-233-01, TC-233-05, and the
//     precondition for TC-233-06's live reassignment)
//   - S233 Demo B -> Coordinator D, Submitted (TC-233-01: a second
//     coordinator with their own event)
//   - S233 Approved Demo -> Coordinator A, Approved (TC-233-05)
//   - S233 Planning Demo -> Coordinator A, Planning, via a real venue
//     booking request (TC-233-05)
//   - S233 Reject Demo -> Coordinator A, Rejected via the real reject action
//     (TC-233-04)
//   - S233 Done Demo -> Coordinator A, status set directly to Completed
//     (TC-233-03) - no "mark complete" action exists in the app yet
//   - S233 Cancel Demo -> Coordinator A, status set directly to Cancelled
//     (TC-233-04) - same reason (SCRUM-105, cancellation, isn't built yet)
//
// Run: npm run db:start && npm run db:reset && npm run seed:users
//      then: node scripts/regression-scrum233.mjs   (dev server must be running)
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
  return data.users.find((user) => user.email === email)?.id;
}

async function ensureCoordinator(email) {
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
  const { error: rolesError } = await admin.from('profiles').update({ roles: ['coordinator'] }).eq('id', userId);
  if (rolesError) throw new Error(`Failed to set roles for ${email}: ${rolesError.message}`);
  console.log(`Ready: ${email} / ${TEST_PASSWORD} (coordinator)`);
  return userId;
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
    throw new Error(`${method} ${path} -> ${res.status}: non-JSON response (likely a redirect to /login)`);
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  const coordinatorDId = await ensureCoordinator('coordinator-d@example.com');
  await ensureCoordinator('coordinator-c@example.com'); // TC-233-02: no events, left alone

  const { data: venue, error: venueError } = await admin
    .from('venues')
    .select('id, name')
    .eq('name', 'Bugis Seminar Room')
    .single();
  if (venueError || !venue) throw new Error(`Bugis Seminar Room not found: ${venueError?.message ?? 'no row'}`);

  const organiserId = await findUserIdByEmail('organiser@example.com');
  if (!organiserId) throw new Error('organiser@example.com not found - run `npm run seed:users` first.');
  const organiserSession = session(await cookieHeaderFor('organiser@example.com', TEST_PASSWORD));
  const leadSession = session(await cookieHeaderFor('ops-manager@example.com', TEST_PASSWORD));
  const coordinatorAId = await findUserIdByEmail('coordinator@example.com');
  const coordinatorASession = session(await cookieHeaderFor('coordinator@example.com', TEST_PASSWORD));

  async function createSubmit(name, proposedDate) {
    const created = await api(organiserSession, 'POST', '/api/event-requests', {
      name,
      purpose: `${name} — purpose for SCRUM-233 manual testing`,
      description: `${name} is seeded test data for the SCRUM-233 coordinator overview test cases.`,
      proposedDate,
      startTime: '09:00',
      endTime: '11:00',
      expectedAttendance: 50,
    });
    return api(organiserSession, 'POST', `/api/event-requests/${created.id}/submit`, undefined);
  }

  // --- S233 Demo A -> Coordinator A, stays Submitted (TC-233-01, 05, 06) ---
  const demoA = await createSubmit('S233 Demo A', '2026-11-15');
  await api(leadSession, 'POST', `/api/event-requests/${demoA.id}/coordinator`, { coordinatorId: coordinatorAId });
  console.log(`S233 Demo A: assigned to Coordinator A, Submitted (${demoA.id})`);

  // --- S233 Demo B -> Coordinator D, stays Submitted (TC-233-01) ---
  const demoB = await createSubmit('S233 Demo B', '2026-11-16');
  await api(leadSession, 'POST', `/api/event-requests/${demoB.id}/coordinator`, { coordinatorId: coordinatorDId });
  console.log(`S233 Demo B: assigned to Coordinator D, Submitted (${demoB.id})`);

  // --- S233 Approved Demo -> Coordinator A, Approved (TC-233-05) ---
  const approvedDemo = await createSubmit('S233 Approved Demo', '2026-11-17');
  await api(leadSession, 'POST', `/api/event-requests/${approvedDemo.id}/coordinator`, { coordinatorId: coordinatorAId });
  await api(coordinatorASession, 'POST', `/api/event-requests/${approvedDemo.id}/approve`, undefined);
  console.log(`S233 Approved Demo: assigned to Coordinator A, Approved (${approvedDemo.id})`);

  // --- S233 Planning Demo -> Coordinator A, Planning via a real venue booking request (TC-233-05) ---
  const planningDemo = await createSubmit('S233 Planning Demo', '2026-11-18');
  await api(leadSession, 'POST', `/api/event-requests/${planningDemo.id}/coordinator`, { coordinatorId: coordinatorAId });
  await api(coordinatorASession, 'POST', `/api/event-requests/${planningDemo.id}/approve`, undefined);
  await api(coordinatorASession, 'POST', `/api/event-requests/${planningDemo.id}/venue-booking-requests`, {
    venueId: venue.id,
    lines: [{ date: '2026-11-18', start: '09:00', end: '11:00' }],
  });
  console.log(`S233 Planning Demo: assigned to Coordinator A, Planning (${planningDemo.id})`);

  // --- S233 Reject Demo -> Coordinator A, Rejected via the real reject action (TC-233-04) ---
  const rejectDemo = await createSubmit('S233 Reject Demo', '2026-11-19');
  await api(leadSession, 'POST', `/api/event-requests/${rejectDemo.id}/coordinator`, { coordinatorId: coordinatorAId });
  await api(coordinatorASession, 'POST', `/api/event-requests/${rejectDemo.id}/reject`, { reason: 'SCRUM-233 test data' });
  console.log(`S233 Reject Demo: assigned to Coordinator A, Rejected (${rejectDemo.id})`);

  // --- S233 Done Demo -> Coordinator A, status set directly to Completed
  // (TC-233-03) - no "mark complete" action exists in the app yet ---
  const doneDemo = await createSubmit('S233 Done Demo', '2026-11-20');
  await api(leadSession, 'POST', `/api/event-requests/${doneDemo.id}/coordinator`, { coordinatorId: coordinatorAId });
  await admin.from('event_request').update({ status: 'completed' }).eq('id', doneDemo.id);
  console.log(`S233 Done Demo: assigned to Coordinator A, status forced to Completed (${doneDemo.id})`);

  // --- S233 Cancel Demo -> Coordinator A, status set directly to Cancelled
  // (TC-233-04) - same reason (SCRUM-105 cancellation isn't built yet) ---
  const cancelDemo = await createSubmit('S233 Cancel Demo', '2026-11-21');
  await api(leadSession, 'POST', `/api/event-requests/${cancelDemo.id}/coordinator`, { coordinatorId: coordinatorAId });
  await admin.from('event_request').update({ status: 'cancelled' }).eq('id', cancelDemo.id);
  console.log(`S233 Cancel Demo: assigned to Coordinator A, status forced to Cancelled (${cancelDemo.id})`);

  console.log(`\nDone. Log in at ${APP_URL}/login with password TestPass123! as:`);
  console.log('  ops-manager@example.com   - the Lead, open /coordinator-overview');
  console.log('  coordinator@example.com   - Coordinator A (3 active: Demo A, Approved Demo, Planning Demo; Reject/Done/Cancel Demo excluded)');
  console.log('  coordinator-d@example.com - Coordinator D (1 active: Demo B)');
  console.log('  coordinator-c@example.com - no events (TC-233-02: should still be listed, empty)');
  console.log('\nFor TC-233-06 (live reassignment): as the Lead, reassign S233 Demo A from');
  console.log(`  Coordinator A to Coordinator D via /assignment-queue/${demoA.id}, then reload`);
  console.log('  /coordinator-overview and confirm it moved from A\'s list to D\'s.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
