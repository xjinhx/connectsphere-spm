// Local test-data setup for manually running the SCRUM-226 test cases
// (TC-226-01 to TC-226-21) against a merged `main`.
//
// Not part of any story: creates an organiser's event, gets it through
// approval and a confirmed venue booking at Bugis Seminar Room for
// 10 Nov 2026, 10:00-12:00, and sets the venue's setup/turnaround minutes
// directly (as the PR's own tests do, until a Venue Staff form exists) -
// 30 min setup, 45 min turnaround, matching the PR description's example.
//
// Run: npm run db:start && npm run db:reset && npm run seed:users
//      then: node scripts/seed-scrum226.mjs   (dev server must be running)
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

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function findUserIdByEmail(email) {
  const { data, error } = await admin.auth.admin.listUsers();
  if (error) throw error;
  return data.users.find((user) => user.email === email)?.id;
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
    throw new Error(`${method} ${path} -> ${res.status}: non-JSON response (likely a redirect to /login - the session went stale)`);
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function main() {
  // --- The card's venue: Bugis Seminar Room, 30 min setup, 45 min turnaround ---
  const { data: venue, error: venueError } = await admin
    .from('venues')
    .select('id, name')
    .eq('name', 'Bugis Seminar Room')
    .single();
  if (venueError || !venue) throw new Error(`Bugis Seminar Room not found: ${venueError?.message ?? 'no row'}`);

  const { error: updateError } = await admin
    .from('venues')
    .update({ setup_minutes: 30, turnaround_minutes: 45 })
    .eq('id', venue.id);
  if (updateError) throw new Error(`Failed to set setup/turnaround: ${updateError.message}`);
  console.log(`Bugis Seminar Room (${venue.id}): setup_minutes=30, turnaround_minutes=45`);

  // --- Second venue, left at 0/0, to check "unchanged" cases (TC-226-14) ---
  const { data: zeroVenue, error: zeroVenueError } = await admin
    .from('venues')
    .select('id, name')
    .eq('name', 'Bugis Old Annex')
    .single();
  if (zeroVenueError || !zeroVenue) {
    console.log('Note: Bugis Old Annex not found - skipping the 0/0 control venue.');
  } else {
    console.log(`Bugis Old Annex (${zeroVenue.id}): left at setup_minutes=0, turnaround_minutes=0 (control)`);
  }

  // --- Organiser creates and submits the event ---
  const organiserId = await findUserIdByEmail('organiser@example.com');
  if (!organiserId) throw new Error('organiser@example.com not found - run `npm run seed:users` first.');
  const organiserSession = session(await cookieHeaderFor('organiser@example.com', TEST_PASSWORD));

  const created = await api(organiserSession, 'POST', '/api/event-requests', {
    name: 'S226 Committed Time Demo',
    purpose: 'S226 Committed Time Demo — purpose for SCRUM-226 manual testing',
    description: 'Seeded test data for the SCRUM-226 setup/turnaround test cases.',
    proposedDate: '2026-11-10',
    startTime: '10:00',
    endTime: '12:00',
    expectedAttendance: 40,
  });
  const submitted = await api(organiserSession, 'POST', `/api/event-requests/${created.id}/submit`, undefined);
  console.log(`Submitted: S226 Committed Time Demo (${submitted.reference}, id ${submitted.id})`);

  // --- Lead assigns Coordinator A (SCRUM-232 AC5: a coordinator must be
  // assigned before the event can be approved) ---
  const coordinatorId = await findUserIdByEmail('coordinator@example.com');
  const leadSession = session(await cookieHeaderFor('ops-manager@example.com', TEST_PASSWORD));
  await api(leadSession, 'POST', `/api/event-requests/${submitted.id}/coordinator`, { coordinatorId });
  console.log('Assigned to coordinator@example.com');

  // --- Coordinator approves, then requests the venue for the card's period ---
  const coordinatorSession = session(await cookieHeaderFor('coordinator@example.com', TEST_PASSWORD));
  await api(coordinatorSession, 'POST', `/api/event-requests/${submitted.id}/approve`, undefined);
  console.log('Approved - planning may begin');

  const bookingRequest = await api(
    coordinatorSession,
    'POST',
    `/api/event-requests/${submitted.id}/venue-booking-requests`,
    { venueId: venue.id, lines: [{ date: '2026-11-10', start: '10:00', end: '12:00' }] },
  );
  const lineId = bookingRequest.lines[0].id;
  console.log(`Requested Bugis Seminar Room, 10 Nov 2026, 10:00-12:00 (request ${bookingRequest.id}, line ${lineId})`);

  // --- Venue Staff approve it, making it a confirmed booking ---
  const venueStaffSession = session(await cookieHeaderFor('venue-staff@example.com', TEST_PASSWORD));
  await api(venueStaffSession, 'POST', `/api/venue-booking-requests/${bookingRequest.id}/decision`, {
    decisions: [{ lineId, decision: 'approve' }],
  });
  console.log('Venue Staff approved the line - now a confirmed booking: committed 09:30-12:45');

  console.log(`\nDone. Log in at ${APP_URL}/login with password TestPass123! as:`);
  console.log('  coordinator@example.com  - Coordinator A, assigned to S226 Committed Time Demo');
  console.log('  venue-staff@example.com  - Venue Staff, decides booking requests');
  console.log('  organiser@example.com    - owns S226 Committed Time Demo');
  console.log('  ops-manager@example.com  - the Lead, assigned the coordinator');
  console.log(`\nDirect links:`);
  console.log(`  Event:  ${APP_URL}/events/${submitted.id}/review`);
  console.log(`  Venue:  ${APP_URL}/venues/${venue.id}`);
  console.log('\nManual test steps (card example: Bugis Seminar Room, 10 Nov 2026):');
  console.log('  AC1: search 10 Nov 2026, 12:30-14:00 -> Bugis Seminar Room not returned');
  console.log('  AC2: request 10 Nov 2026, 12:30-14:00 -> refused, clashes with 09:30-12:45');
  console.log('  AC3: submit a request for 12:30-14:00 BEFORE approving it, then try to approve -> refused, names the clash');
  console.log('  AC4: view the calendar for 10 Nov 2026 -> 09:30-12:45 occupied, no event details');
  console.log('  AC5: 13:15 start succeeds at search/request/approval; 13:00 start is refused at each');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
