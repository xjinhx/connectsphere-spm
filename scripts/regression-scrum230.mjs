// Reviewer regression setup for PR #106 (SCRUM-230: give each venue booking
// its own attendance and requirements), run against a freshly reset `main`.
//
// Not part of any story. Creates an event with expected_attendance 500, two
// venue booking requests at two Marina Bay venues for the same date/time
// (AC6: per-venue clash check), one left blank (uses the event's 500, AC1/2)
// and one with its own smaller attendance (AC1/3), then confirms both so
// AC4/AC5's capacity cut has a real confirmed booking to test against.
//
// Creates "Marina Bay Meeting Room" (capacity 60) directly, matching the
// PR description's own test data, so the breakout room is in the same
// building as Marina Bay Ballroom (the "auditorium").
//
// Run: npm run db:start && npm run db:reset && npm run seed:users
//      then: node scripts/regression-scrum230.mjs   (dev server must be running)
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
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function main() {
  // --- Marina Bay Ballroom (the seeded "auditorium") ---
  const { data: ballroom, error: ballroomError } = await admin
    .from('venues')
    .select('id, name')
    .eq('name', 'Marina Bay Ballroom')
    .single();
  if (ballroomError || !ballroom) throw new Error(`Marina Bay Ballroom not found: ${ballroomError?.message ?? 'no row'}`);

  // --- Marina Bay Meeting Room (the "breakout room", created here to match
  // the PR description's own test data: capacity 60, same building) ---
  const { data: marinaBayLocation, error: locationError } = await admin
    .from('locations')
    .select('id')
    .eq('name', 'Marina Bay')
    .single();
  if (locationError || !marinaBayLocation) throw new Error(`Marina Bay location not found: ${locationError?.message ?? 'no row'}`);

  let meetingRoom;
  const { data: existingMeetingRoom } = await admin
    .from('venues')
    .select('id, name')
    .eq('name', 'Marina Bay Meeting Room')
    .maybeSingle();
  if (existingMeetingRoom) {
    meetingRoom = existingMeetingRoom;
    await admin.from('venues').update({ max_capacity: 60, is_retired: false }).eq('id', meetingRoom.id);
    console.log(`Marina Bay Meeting Room already existed (${meetingRoom.id}), reset to capacity 60`);
  } else {
    const { data: created, error: createError } = await admin
      .from('venues')
      .insert({
        name: 'Marina Bay Meeting Room',
        location_id: marinaBayLocation.id,
        max_capacity: 60,
        operating_slots: ['am', 'pm'],
        needs_setup_slot: false,
        needs_turnaround_slot: false,
        is_retired: false,
      })
      .select('id, name')
      .single();
    if (createError) throw new Error(`Failed to create Marina Bay Meeting Room: ${createError.message}`);
    meetingRoom = created;
    console.log(`Created Marina Bay Meeting Room (${meetingRoom.id}), capacity 60`);
  }

  // --- Organiser creates and submits a 500-person event ---
  const organiserId = await findUserIdByEmail('organiser@example.com');
  if (!organiserId) throw new Error('organiser@example.com not found - run `npm run seed:users` first.');
  const organiserSession = session(await cookieHeaderFor('organiser@example.com', TEST_PASSWORD));

  const created = await api(organiserSession, 'POST', '/api/event-requests', {
    name: 'S230 Conference',
    purpose: 'S230 Conference — purpose for SCRUM-230 regression testing',
    description: 'Seeded test data for the SCRUM-230 own-attendance/requirements test cases.',
    proposedDate: '2026-11-12',
    startTime: '10:00',
    endTime: '13:00',
    expectedAttendance: 500,
  });
  const submitted = await api(organiserSession, 'POST', `/api/event-requests/${created.id}/submit`, undefined);
  console.log(`Submitted: S230 Conference (${submitted.reference}, id ${submitted.id}, expected attendance 500)`);

  // --- Lead assigns Coordinator A, Coordinator approves ---
  const coordinatorId = await findUserIdByEmail('coordinator@example.com');
  const leadSession = session(await cookieHeaderFor('ops-manager@example.com', TEST_PASSWORD));
  await api(leadSession, 'POST', `/api/event-requests/${submitted.id}/coordinator`, { coordinatorId });
  console.log('Assigned to coordinator@example.com');

  const coordinatorSession = session(await cookieHeaderFor('coordinator@example.com', TEST_PASSWORD));
  await api(coordinatorSession, 'POST', `/api/event-requests/${submitted.id}/approve`, undefined);
  console.log('Approved - planning may begin');

  // --- Request A: Marina Bay Ballroom (auditorium), attendance left blank -
  // AC1/AC2: uses the event's own 500 ---
  const requestA = await api(
    coordinatorSession,
    'POST',
    `/api/event-requests/${submitted.id}/venue-booking-requests`,
    { venueId: ballroom.id, lines: [{ date: '2026-11-12', start: '10:00', end: '13:00' }] },
  );
  console.log(`Request A: Marina Bay Ballroom, 12 Nov 2026 10:00-13:00, no own attendance (request ${requestA.id})`);

  // --- Request B: Marina Bay Meeting Room (breakout), same date/time, own
  // attendance 40 - AC1/AC3/AC6 ---
  const requestB = await api(
    coordinatorSession,
    'POST',
    `/api/event-requests/${submitted.id}/venue-booking-requests`,
    {
      venueId: meetingRoom.id,
      lines: [{ date: '2026-11-12', start: '10:00', end: '13:00' }],
      expectedAttendance: 40,
    },
  );
  console.log(`Request B: Marina Bay Meeting Room, 12 Nov 2026 10:00-13:00, own attendance 40 (request ${requestB.id})`);

  // --- Venue Staff confirms both lines ---
  const venueStaffSession = session(await cookieHeaderFor('venue-staff@example.com', TEST_PASSWORD));
  await api(venueStaffSession, 'POST', `/api/venue-booking-requests/${requestA.id}/decision`, {
    decisions: [{ lineId: requestA.lines[0].id, decision: 'approve' }],
  });
  console.log('Venue Staff confirmed Request A (Marina Bay Ballroom)');
  await api(venueStaffSession, 'POST', `/api/venue-booking-requests/${requestB.id}/decision`, {
    decisions: [{ lineId: requestB.lines[0].id, decision: 'approve' }],
  });
  console.log('Venue Staff confirmed Request B (Marina Bay Meeting Room)');

  console.log(`\nDone. Log in at ${APP_URL}/login with password TestPass123! as:`);
  console.log('  coordinator@example.com  - Coordinator A, assigned to S230 Conference');
  console.log('  venue-staff@example.com  - Venue Staff, decides booking requests');
  console.log('  organiser@example.com    - owns S230 Conference');
  console.log('  ops-manager@example.com  - the Lead, assigned the coordinator');
  console.log('\nDirect links:');
  console.log(`  Event:            ${APP_URL}/events/${submitted.id}/review`);
  console.log(`  Request A (500):  ${APP_URL}/venue-booking-requests/${requestA.id}`);
  console.log(`  Request B (40):   ${APP_URL}/venue-booking-requests/${requestB.id}`);
  console.log(`  Marina Bay Meeting Room: ${APP_URL}/venues/${meetingRoom.id}`);
  console.log('\nManual test steps:');
  console.log('  AC1/AC2: Request A shows attendance 500 marked "(event\'s)"; Request B shows its own 40');
  console.log('  AC3: both request pages shown side by side with their own attendance');
  console.log('  AC4: cut Marina Bay Meeting Room capacity to 45 -> Request B (40) not listed as affected');
  console.log('  AC5: cut Marina Bay Meeting Room capacity to 39 -> Request B (40) listed, must confirm');
  console.log('  AC6: both requests (same date/time, different venues) both exist as confirmed bookings');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
