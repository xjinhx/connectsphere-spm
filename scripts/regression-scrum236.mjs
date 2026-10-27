// Reviewer regression setup for PR #105 (SCRUM-236: see my event's booking
// requests from the event page), run against a freshly reset `main`.
//
// Not part of any story. Creates two events assigned to coordinator@example.com:
//   - "S236 Harbour Summit": four venue booking requests, one per status
//     (pending, approved, partially approved, rejected) across three seeded
//     venues (AC1/TC-236-01/02), plus each decided request's audit trail
//     (AC2/TC-236-04/05).
//   - "S236 Quiet Workshop": no venue booking requests at all (AC3/TC-236-06).
// Also creates a third event for another-coordinator@example.com with its own
// request, to check it never appears on S236 Harbour Summit's list
// (AC1/TC-236-03).
//
// Run: npm run db:start && npm run db:reset && npm run seed:users
//      then: node scripts/regression-scrum236.mjs   (dev server must be running)
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

async function ensureUser(email, role) {
  const { data: created, error } = await admin.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });
  let userId = created?.user?.id;
  if (error) {
    if (!error.message.toLowerCase().includes('already been registered')) throw error;
    userId = await findUserIdByEmail(email);
  }
  await admin.from('profiles').update({ roles: [role] }).eq('id', userId);
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
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function venueId(name) {
  const { data, error } = await admin.from('venues').select('id').eq('name', name).single();
  if (error || !data) throw new Error(`Venue not found: ${name}`);
  return data.id;
}

async function createAndApproveEvent(organiserSession, coordinatorSession, leadSession, coordinatorId, name, date) {
  const created = await api(organiserSession, 'POST', '/api/event-requests', {
    name,
    purpose: `${name} — purpose for SCRUM-236 regression testing`,
    description: `Seeded test data for the SCRUM-236 booking-requests-list test cases.`,
    proposedDate: date,
    startTime: '09:00',
    endTime: '11:00',
    expectedAttendance: 50,
  });
  const submitted = await api(organiserSession, 'POST', `/api/event-requests/${created.id}/submit`, undefined);
  await api(leadSession, 'POST', `/api/event-requests/${submitted.id}/coordinator`, { coordinatorId });
  await api(coordinatorSession, 'POST', `/api/event-requests/${submitted.id}/approve`, undefined);
  console.log(`Submitted + approved: ${name} (${submitted.reference}, id ${submitted.id})`);
  return submitted.id;
}

async function main() {
  const organiserId = await ensureUser('organiser@example.com', 'event_organiser');
  const coordinatorId = await ensureUser('coordinator@example.com', 'coordinator');
  const otherCoordinatorId = await ensureUser('another-coordinator+s236@connectsphere.example.com', 'coordinator');
  await ensureUser('ops-manager@example.com', 'operations_manager');
  await ensureUser('venue-staff@example.com', 'venue_staff');

  const organiserSession = session(await cookieHeaderFor('organiser@example.com', TEST_PASSWORD));
  const coordinatorSession = session(await cookieHeaderFor('coordinator@example.com', TEST_PASSWORD));
  const otherCoordinatorSession = session(await cookieHeaderFor('another-coordinator+s236@connectsphere.example.com', TEST_PASSWORD));
  const leadSession = session(await cookieHeaderFor('ops-manager@example.com', TEST_PASSWORD));
  const venueStaffSession = session(await cookieHeaderFor('venue-staff@example.com', TEST_PASSWORD));

  const bugis = await venueId('Bugis Seminar Room');
  const marina = await venueId('Marina Bay Ballroom');
  const jurong = await venueId('Jurong East Training Room');

  // --- S236 Harbour Summit: one request per status, newest first ---
  const harbourSummitId = await createAndApproveEvent(
    organiserSession, coordinatorSession, leadSession, coordinatorId, 'S236 Harbour Summit', '2026-12-01',
  );

  const pending = await api(coordinatorSession, 'POST', `/api/event-requests/${harbourSummitId}/venue-booking-requests`, {
    venueId: bugis, lines: [{ date: '2026-12-10', start: '09:00', end: '11:00' }],
  });
  console.log(`Pending request: Bugis Seminar Room, 10 Dec 2026 09:00-11:00 (request ${pending.id})`);

  const approved = await api(coordinatorSession, 'POST', `/api/event-requests/${harbourSummitId}/venue-booking-requests`, {
    venueId: marina, lines: [{ date: '2026-12-11', start: '13:00', end: '15:00' }],
  });
  await api(venueStaffSession, 'POST', `/api/venue-booking-requests/${approved.id}/decision`, {
    decisions: [{ lineId: approved.lines[0].id, decision: 'approve' }],
  });
  console.log(`Approved request: Marina Bay Ballroom, 11 Dec 2026 13:00-15:00 (request ${approved.id}) — decided by venue-staff@example.com`);

  const partial = await api(coordinatorSession, 'POST', `/api/event-requests/${harbourSummitId}/venue-booking-requests`, {
    venueId: jurong,
    lines: [
      { date: '2026-12-12', start: '09:00', end: '10:00' },
      { date: '2026-12-13', start: '09:00', end: '10:00' },
    ],
  });
  await api(venueStaffSession, 'POST', `/api/venue-booking-requests/${partial.id}/decision`, {
    decisions: [
      { lineId: partial.lines[0].id, decision: 'approve' },
      { lineId: partial.lines[1].id, decision: 'reject', reason: 'Room double-booked for maintenance' },
    ],
  });
  console.log(`Partially approved request: Jurong East Training Room, 12-13 Dec 2026 (request ${partial.id}) — decided by venue-staff@example.com`);

  const rejected = await api(coordinatorSession, 'POST', `/api/event-requests/${harbourSummitId}/venue-booking-requests`, {
    venueId: bugis, lines: [{ date: '2026-12-14', start: '15:00', end: '17:00' }],
  });
  await api(venueStaffSession, 'POST', `/api/venue-booking-requests/${rejected.id}/decision`, {
    decisions: [{ lineId: rejected.lines[0].id, decision: 'reject', reason: 'Closed for a private function' }],
  });
  console.log(`Rejected request: Bugis Seminar Room, 14 Dec 2026 15:00-17:00 (request ${rejected.id}) — decided by venue-staff@example.com`);

  // --- S236 Quiet Workshop: no requests at all ---
  const quietWorkshopId = await createAndApproveEvent(
    organiserSession, coordinatorSession, leadSession, coordinatorId, 'S236 Quiet Workshop', '2026-12-02',
  );

  // --- Another coordinator's event, with its own request, for isolation ---
  const otherEventId = await createAndApproveEvent(
    organiserSession, otherCoordinatorSession, leadSession, otherCoordinatorId, 'S236 Other Coordinator Event', '2026-12-03',
  );
  const otherRequest = await api(otherCoordinatorSession, 'POST', `/api/event-requests/${otherEventId}/venue-booking-requests`, {
    venueId: bugis, lines: [{ date: '2026-12-15', start: '09:00', end: '10:00' }],
  });
  console.log(`Other coordinator's own request (should never appear on Harbour Summit's list): request ${otherRequest.id}`);

  console.log(`\nDone. Log in at ${APP_URL}/login with password ${TEST_PASSWORD} as:`);
  console.log('  coordinator@example.com  - owns S236 Harbour Summit and S236 Quiet Workshop');
  console.log('  venue-staff@example.com  - decided the approved/partial/rejected requests');
  console.log('  organiser@example.com    - owns all three events');
  console.log('\nDirect links:');
  console.log(`  S236 Harbour Summit (4 requests, newest first): ${APP_URL}/events/${harbourSummitId}/review`);
  console.log(`  S236 Quiet Workshop (no requests):               ${APP_URL}/events/${quietWorkshopId}/review`);
  console.log(`  Pending request page:            ${APP_URL}/venue-booking-requests/${pending.id}`);
  console.log(`  Partially approved request page: ${APP_URL}/venue-booking-requests/${partial.id}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
