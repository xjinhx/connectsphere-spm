// Local test-data setup for manually running the SCRUM-234 test cases
// (TC-234-01 to TC-234-19) against a merged `main`.
//
// Not part of any story: builds the fixture events the SCRUM-234 tab of
// Team_Owned_ScrumsTest.xlsx describes (S234 Harbour Gala, Quiet Workshop,
// Two-Venue Summit, Riverside Forum, Spare Gala, and the four "stays out of
// the list" siblings), and the SO Coordinator account (TC-234-03).
//
// Two fixtures have no UI/API path yet, as the card itself expects (TC-234-04:
// "set back to Confirmed in Studio - no Confirm action exists yet"), so this
// script sets them directly via the admin client, the same as the SCRUM-226
// and SCRUM-233 seed scripts do for their own no-screen-yet states:
//   - moving an approved/planning event to Confirmed
//   - clearing Quiet Workshop's attendance after creation, so it can reach
//     Confirmed (attendance is mandatory to submit) and then read as
//     "not recorded" (TC-234-06)
//
// Run: npm run db:start && npm run db:reset && npm run seed:users
//      then: node scripts/seed-scrum234.mjs   (dev server must be running)
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
  // --- Accounts ---
  const organiserId = await findUserIdByEmail('organiser@example.com');
  const coordinatorId = await findUserIdByEmail('coordinator@example.com');
  const safetyOfficerId = await findUserIdByEmail('safety-officer@example.com');
  if (!organiserId || !coordinatorId || !safetyOfficerId) {
    throw new Error('Base accounts not found - run `npm run seed:users` first.');
  }

  let soCoordId = await findUserIdByEmail('so-coord@example.com');
  if (!soCoordId) {
    const { data, error } = await admin.auth.admin.createUser({
      email: 'so-coord@example.com',
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`could not create so-coord@example.com: ${error?.message}`);
    soCoordId = data.user.id;
  }
  await admin.from('profiles').update({ roles: ['coordinator', 'safety_officer'], full_name: 'SO Coordinator' }).eq('id', soCoordId);
  console.log('Ready: so-coord@example.com / TestPass123! (coordinator, safety_officer) - TC-234-03');

  const organiserSession = session(await cookieHeaderFor('organiser@example.com', TEST_PASSWORD));
  const leadSession = session(await cookieHeaderFor('ops-manager@example.com', TEST_PASSWORD));
  const coordinatorSession = session(await cookieHeaderFor('coordinator@example.com', TEST_PASSWORD));
  const venueStaffSession = session(await cookieHeaderFor('venue-staff@example.com', TEST_PASSWORD));
  const techSupportSession = session(await cookieHeaderFor('tech-support@example.com', TEST_PASSWORD));

  // --- Venues (seeded by supabase/seed.sql) ---
  const { data: bugis } = await admin.from('venues').select('id,name').eq('name', 'Bugis Seminar Room').single();
  const { data: marina } = await admin.from('venues').select('id,name').eq('name', 'Marina Bay Ballroom').single();
  if (!bugis || !marina) throw new Error('Expected venues (Bugis Seminar Room, Marina Bay Ballroom) not found.');

  // --- Accessibility feature (AC2: "Step-free access") ---
  const { data: stepFree } = await admin.from('accessibility_features').select('id').eq('name', 'Step-free access').single();
  if (!stepFree) throw new Error('Accessibility feature "Step-free access" not found.');

  // --- Equipment catalogue items (AC2: "Projector x2, Wireless microphone x4") ---
  async function ensureEquipment(name) {
    const { data: existing } = await admin.from('equipment').select('id').eq('name', name).maybeSingle();
    if (existing) return existing.id;
    const created = await api(techSupportSession, 'POST', '/api/equipment', {
      name,
      category: 'av',
      quantity: 10,
      currentLocation: 'Bugis store room',
    });
    return created.id;
  }
  const projectorId = await ensureEquipment('Projector');
  const micId = await ensureEquipment('Wireless microphone');
  console.log(`Equipment ready: Projector (${projectorId}), Wireless microphone (${micId})`);

  // --- Helpers to build an event through to a given point ---
  async function createEvent({ name, proposedDate, startTime, endTime, expectedAttendance, roomLayout, accessibility }) {
    const created = await api(organiserSession, 'POST', '/api/event-requests', {
      name,
      purpose: `${name} - purpose for SCRUM-234 manual testing`,
      description: 'Seeded test data for the SCRUM-234 operational safety check test cases.',
      proposedDate,
      startTime,
      endTime,
      expectedAttendance,
      ...(roomLayout ? { roomLayout } : {}),
      ...(accessibility
        ? {
            accessibilityRequired: true,
            accessibilityFeatureIds: [stepFree.id],
            accessibilityNotes: accessibility,
          }
        : {}),
    });
    await api(organiserSession, 'POST', `/api/event-requests/${created.id}/submit`, undefined);
    await api(leadSession, 'POST', `/api/event-requests/${created.id}/coordinator`, { coordinatorId });
    await api(coordinatorSession, 'POST', `/api/event-requests/${created.id}/approve`, undefined);
    return created.id;
  }

  async function bookVenue(eventId, venueId, date, start, end) {
    const request = await api(coordinatorSession, 'POST', `/api/event-requests/${eventId}/venue-booking-requests`, {
      venueId,
      lines: [{ date, start, end }],
    });
    const lineId = request.lines[0].id;
    await api(venueStaffSession, 'POST', `/api/venue-booking-requests/${request.id}/decision`, {
      decisions: [{ lineId, decision: 'approve' }],
    });
  }

  async function confirm(eventId) {
    const { error } = await admin.from('event_request').update({ status: 'confirmed' }).eq('id', eventId);
    if (error) throw new Error(`could not confirm event ${eventId}: ${error.message}`);
  }

  // --- S234 Harbour Gala: the full AC2 picture, Confirmed (TC-234-05, 08, 19) ---
  const harbourGala = await createEvent({
    name: `S234 Harbour Gala`,
    proposedDate: '2026-11-20',
    startTime: '10:00',
    endTime: '12:00',
    expectedAttendance: 80,
    roomLayout: 'theatre',
    accessibility: 'Wheelchair spaces at the front',
  });
  await api(coordinatorSession, 'POST', `/api/event-requests/${harbourGala}/equipment-request/lines`, { equipmentId: projectorId, quantity: 2 });
  await api(coordinatorSession, 'POST', `/api/event-requests/${harbourGala}/equipment-request/lines`, { equipmentId: micId, quantity: 4 });
  await bookVenue(harbourGala, bugis.id, '2026-11-20', '10:00', '12:00');
  await confirm(harbourGala);
  console.log(`S234 Harbour Gala: ${harbourGala} (Confirmed)`);

  // --- S234 Quiet Workshop: nothing recorded, Confirmed (TC-234-06) ---
  const quietWorkshop = await createEvent({
    name: `S234 Quiet Workshop`,
    proposedDate: '2026-11-23',
    startTime: '10:00',
    endTime: '12:00',
    expectedAttendance: 1, // placeholder: mandatory to submit, cleared below
  });
  await bookVenue(quietWorkshop, bugis.id, '2026-11-23', '10:00', '12:00');
  await confirm(quietWorkshop);
  const { error: clearError } = await admin
    .from('event_request')
    .update({ expected_attendance: null, room_layout: null, accessibility_required: null, accessibility_notes: null })
    .eq('id', quietWorkshop);
  if (clearError) throw new Error(`could not clear Quiet Workshop's details: ${clearError.message}`);
  console.log(`S234 Quiet Workshop: ${quietWorkshop} (Confirmed, nothing recorded)`);

  // --- S234 Two-Venue Summit: two confirmed bookings, Confirmed (TC-234-07) ---
  const twoVenueSummit = await createEvent({
    name: `S234 Two-Venue Summit`,
    proposedDate: '2026-11-24',
    startTime: '10:00',
    endTime: '12:00',
    expectedAttendance: 100,
    roomLayout: 'theatre',
  });
  await bookVenue(twoVenueSummit, bugis.id, '2026-11-24', '10:00', '12:00');
  await bookVenue(twoVenueSummit, marina.id, '2026-11-24', '10:00', '12:00');
  await confirm(twoVenueSummit);
  console.log(`S234 Two-Venue Summit: ${twoVenueSummit} (Confirmed, two venues)`);

  // --- S234 Riverside Forum: Confirmed, for AC4's request-changes/reject/re-confirm chain (TC-234-04, 10, 11) ---
  const riversideForum = await createEvent({
    name: `S234 Riverside Forum`,
    proposedDate: '2026-11-21',
    startTime: '10:00',
    endTime: '12:00',
    expectedAttendance: 60,
    roomLayout: 'theatre',
  });
  await bookVenue(riversideForum, bugis.id, '2026-11-21', '10:00', '12:00');
  await confirm(riversideForum);
  console.log(`S234 Riverside Forum: ${riversideForum} (Confirmed)`);

  // --- S234 Spare Gala: Confirmed, left untouched for AC5/AC6's API-only checks (TC-234-13 to 18) ---
  const spareGala = await createEvent({
    name: `S234 Spare Gala`,
    proposedDate: '2026-11-26',
    startTime: '10:00',
    endTime: '12:00',
    expectedAttendance: 40,
  });
  await bookVenue(spareGala, bugis.id, '2026-11-26', '10:00', '12:00');
  await confirm(spareGala);
  console.log(`S234 Spare Gala: ${spareGala} (Confirmed)`);

  // --- Siblings proving AC1's exclusion (TC-234-02): Planning, Approved, Cancelled, Completed ---
  const planningLaunch = await createEvent({
    name: `S234 Planning Launch`,
    proposedDate: '2026-11-27',
    startTime: '10:00',
    endTime: '12:00',
    expectedAttendance: 30,
  });
  // A booking REQUEST (not yet decided) moves Approved -> Planning (SCRUM-101's trigger).
  await api(coordinatorSession, 'POST', `/api/event-requests/${planningLaunch}/venue-booking-requests`, {
    venueId: bugis.id,
    lines: [{ date: '2026-11-27', start: '14:00', end: '16:00' }],
  });
  console.log(`S234 Planning Launch: ${planningLaunch} (Planning)`);

  const approvedOnly = await createEvent({
    name: `S234 Approved Only`,
    proposedDate: '2026-11-28',
    startTime: '10:00',
    endTime: '12:00',
    expectedAttendance: 30,
  });
  console.log(`S234 Approved Only: ${approvedOnly} (Approved)`);

  const cancelledNight = await createEvent({
    name: `S234 Cancelled Night`,
    proposedDate: '2026-11-29',
    startTime: '19:00',
    endTime: '22:00',
    expectedAttendance: 30,
  });
  await admin.from('event_request').update({ status: 'cancelled' }).eq('id', cancelledNight);
  console.log(`S234 Cancelled Night: ${cancelledNight} (Cancelled)`);

  const completedDay = await createEvent({
    name: `S234 Completed Day`,
    proposedDate: '2026-11-30',
    startTime: '10:00',
    endTime: '12:00',
    expectedAttendance: 30,
  });
  await bookVenue(completedDay, bugis.id, '2026-11-30', '10:00', '12:00');
  await confirm(completedDay);
  await admin.from('event_request').update({ status: 'completed' }).eq('id', completedDay);
  console.log(`S234 Completed Day: ${completedDay} (Completed)`);

  console.log(`\nDone. Log in at ${APP_URL}/login with password TestPass123! as:`);
  console.log('  safety-officer@example.com - Safety Officer only, lands on /safety-checks');
  console.log('  so-coord@example.com       - Coordinator + Safety Officer (TC-234-03)');
  console.log('  coordinator@example.com    - Coordinator Casey, assigned to every event above');
  console.log('  venue-staff@example.com    - Venue Staff, decides booking requests');
  console.log('  organiser@example.com      - owns every event above');
  console.log('  ops-manager@example.com    - the Lead, assigned the coordinator');
  console.log('\nDirect links:');
  console.log(`  Safety checks list:   ${APP_URL}/safety-checks`);
  console.log(`  S234 Harbour Gala:    ${APP_URL}/safety-checks/${harbourGala}  (review page: ${APP_URL}/events/${harbourGala}/review)`);
  console.log(`  S234 Quiet Workshop:  ${APP_URL}/safety-checks/${quietWorkshop}`);
  console.log(`  S234 Two-Venue Summit:${APP_URL}/safety-checks/${twoVenueSummit}`);
  console.log(`  S234 Riverside Forum: ${APP_URL}/safety-checks/${riversideForum}  (review page: ${APP_URL}/events/${riversideForum}/review)`);
  console.log(`  S234 Spare Gala:      ${APP_URL}/safety-checks/${spareGala}  (id for API calls: ${spareGala})`);
  console.log(`  S234 Planning Launch id (for API 409 check): ${planningLaunch}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
