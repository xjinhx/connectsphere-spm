// SCRUM-226 AC3 setup: a pending booking request submitted BEFORE a clashing
// booking elsewhere at the same venue was confirmed, so trying to approve it
// afterwards is refused and the clashing booking is identified.
//
// Builds two events at Jurong East Training Room (left untouched by
// seed-scrum226.mjs), 10 Nov 2026:
//   Demo A - requests 12:30-14:00, left PENDING on purpose
//   Demo B - requests 10:00-12:00, approved by Venue Staff (confirms it,
//            widened to 09:30-12:45 by the venue's 30 min setup / 45 min
//            turnaround)
//
// After this script, only the manual step is left: as venue-staff@example.com,
// try to approve Demo A's 12:30-14:00 line and screenshot the refusal
// (TC-226-04b).
//
// Run: node scripts/seed-scrum226.mjs first (base accounts), then this.
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

async function createApprovedEventWithVenueRequest(organiserSession, leadSession, coordinatorSession, coordinatorId, { name, venueId, line }) {
  const created = await api(organiserSession, 'POST', '/api/event-requests', {
    name,
    purpose: `${name} — purpose for SCRUM-226 AC3 manual testing`,
    description: `${name} is seeded test data for SCRUM-226's AC3 ordering scenario.`,
    proposedDate: '2026-11-10',
    startTime: line.start,
    endTime: line.end,
    expectedAttendance: 20,
  });
  const submitted = await api(organiserSession, 'POST', `/api/event-requests/${created.id}/submit`, undefined);
  await api(leadSession, 'POST', `/api/event-requests/${submitted.id}/coordinator`, { coordinatorId });
  await api(coordinatorSession, 'POST', `/api/event-requests/${submitted.id}/approve`, undefined);
  const bookingRequest = await api(
    coordinatorSession,
    'POST',
    `/api/event-requests/${submitted.id}/venue-booking-requests`,
    { venueId, lines: [{ date: '2026-11-10', start: line.start, end: line.end }] },
  );
  return { eventId: submitted.id, bookingRequestId: bookingRequest.id, lineId: bookingRequest.lines[0].id };
}

async function main() {
  const { data: venue, error: venueError } = await admin
    .from('venues')
    .select('id, name')
    .eq('name', 'Jurong East Training Room')
    .single();
  if (venueError || !venue) throw new Error(`Jurong East Training Room not found: ${venueError?.message ?? 'no row'}`);

  const { error: updateError } = await admin
    .from('venues')
    .update({ setup_minutes: 30, turnaround_minutes: 45 })
    .eq('id', venue.id);
  if (updateError) throw new Error(`Failed to set setup/turnaround: ${updateError.message}`);
  console.log(`Jurong East Training Room (${venue.id}): setup_minutes=30, turnaround_minutes=45`);

  const organiserId = await findUserIdByEmail('organiser@example.com');
  const coordinatorId = await findUserIdByEmail('coordinator@example.com');
  if (!organiserId || !coordinatorId) throw new Error('Base accounts not found - run npm run seed:users and seed-scrum226.mjs first.');

  const organiserSession = session(await cookieHeaderFor('organiser@example.com', TEST_PASSWORD));
  const leadSession = session(await cookieHeaderFor('ops-manager@example.com', TEST_PASSWORD));
  const coordinatorSession = session(await cookieHeaderFor('coordinator@example.com', TEST_PASSWORD));
  const venueStaffSession = session(await cookieHeaderFor('venue-staff@example.com', TEST_PASSWORD));

  // Demo A FIRST - pending request for 12:30-14:00, submitted while nothing
  // at this venue clashes with it yet.
  const demoA = await createApprovedEventWithVenueRequest(organiserSession, leadSession, coordinatorSession, coordinatorId, {
    name: 'S226 AC3 Demo A',
    venueId: venue.id,
    line: { start: '12:30', end: '14:00' },
  });
  console.log(`Demo A: requested 12:30-14:00, left PENDING (event ${demoA.eventId}, line ${demoA.lineId})`);

  // Demo B SECOND - requests and is immediately confirmed for 10:00-12:00,
  // which widens to 09:30-12:45 and now retroactively clashes with Demo A.
  const demoB = await createApprovedEventWithVenueRequest(organiserSession, leadSession, coordinatorSession, coordinatorId, {
    name: 'S226 AC3 Demo B',
    venueId: venue.id,
    line: { start: '10:00', end: '12:00' },
  });
  await api(venueStaffSession, 'POST', `/api/venue-booking-requests/${demoB.bookingRequestId}/decision`, {
    decisions: [{ lineId: demoB.lineId, decision: 'approve' }],
  });
  console.log(`Demo B: requested and CONFIRMED 10:00-12:00 (event ${demoB.eventId}) - committed 09:30-12:45`);

  console.log('\nDone. Only the manual step is left for TC-226-04:');
  console.log('  1. Log in as venue-staff@example.com');
  console.log(`  2. Open the Demo A booking request: ${APP_URL}/venue-booking-requests/${demoA.bookingRequestId}`);
  console.log('  3. Try to approve the 12:30-14:00 line');
  console.log('  Expected: refused, naming Demo B\'s confirmed booking as the clash');
  console.log(`\nFor reference, Demo B's confirmed booking: ${APP_URL}/events/${demoB.eventId}/review`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
