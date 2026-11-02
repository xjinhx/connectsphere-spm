// Seeds SCRUM-111's manual run (TC-111-01 to TC-111-14): flag affected
// arrangements and mark them for review after a significant change. Only what
// those test cases need, and nothing from other stories' seeds.
//
// Run: npm run db:start && npm run db:reset   (seed.sql gives Marina Bay Ballroom and Bugis Seminar Room)
//      node scripts/seed-scrum111.mjs          (no dev server needed)
//
// Safe to run again: the accounts are updated in place, and every "S111" event
// (with its bookings and reservations) and the S111 projector are deleted and
// recreated.
//
// Accounts, all with password TestPass123!:
//   coordinator@         Event Coordinator ("Coordinator A"), assigned to every S111 event
//   coordinator-b@       Event Coordinator, not assigned (TC-111-12)
//   organiser@           Event Organiser, Harbour Events Pte Ltd, who requested them
//   venue-staff@         Venue Staff, who approved the bookings
//   tech-support@        Technical Support Staff, who reserved the projector
//   ops-manager@         Event Coordinator Lead, who assigned the coordinator
//
// Events (one venue booking each, approved the real way):
//   S111 Harbour Gala     Planning, 4 weeks ahead, 10:00-12:00, 150 attending, Marina Bay Ballroom (TC-111-01 to 03, 06, 09, 11, 12)
//   S111 AV Night         Planning, 5 weeks ahead, 19:00-22:00, 80 attending, Bugis Seminar Room,
//                         S111 Projector P-100 x 2 reserved (TC-111-04, 05, 10)
//   S111 Tomorrow Brief   Confirmed, tomorrow, 10:00-12:00, Bugis Seminar Room (TC-111-07)
//   S111 Full House       Planning, 6 weeks ahead, 10:00-12:00, Marina Bay Ballroom,
//                         S111 Projector P-100 x 2 reserved (TC-111-08, 13, 14)
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_PASSWORD = 'TestPass123!';
const PREFIX = 'S111';
const PROJECTOR = 'S111 Projector P-100';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script.');
}

// Creates accounts with a known password through the service-role key, so it
// refuses to run against anything but the local stack (same guard as
// scripts/seed-scrum110.mjs).
if (!['127.0.0.1', 'localhost'].includes(new URL(SUPABASE_URL).hostname)) {
  throw new Error(`NEXT_PUBLIC_SUPABASE_URL (${SUPABASE_URL}) is not a local Supabase instance; refusing to run.`);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function check(label, { error }) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

async function userIdByEmail(email) {
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((user) => user.email === email)?.id;
}

async function ensureUser(email, roles, fullName, clientOrganisationId = null) {
  const { error } = await supabase.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });
  if (error && !error.message.toLowerCase().includes('already been registered')) {
    throw new Error(`create ${email}: ${error.message}`);
  }
  const id = await userIdByEmail(email);
  if (!id) throw new Error(`${email} not found after creating it.`);
  check(
    `profile ${email}`,
    await supabase
      .from('profiles')
      .update({ roles, full_name: fullName, client_organisation_id: clientOrganisationId })
      .eq('id', id),
  );
  return id;
}

async function ensureOrganisation(name) {
  const { data: found } = await supabase.from('client_organisations').select('id').eq('name', name).maybeSingle();
  if (found) return found.id;
  const { data, error } = await supabase.from('client_organisations').insert({ name }).select('id').single();
  if (error) throw new Error(`organisation ${name}: ${error.message}`);
  return data.id;
}

/** Today in Singapore plus `days`, as YYYY-MM-DD. */
function daysAhead(days) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// --- Organisation and accounts -----------------------------------------------
const harbour = await ensureOrganisation('Harbour Events Pte Ltd');

const ids = {};
for (const [email, roles, fullName, org] of [
  ['organiser@example.com', ['event_organiser'], 'Organiser', harbour],
  ['coordinator@example.com', ['coordinator'], 'Coordinator A', null],
  ['coordinator-b@example.com', ['coordinator'], 'Coordinator B', null],
  ['venue-staff@example.com', ['venue_staff'], 'Venue Staff', null],
  ['tech-support@example.com', ['technical_support'], 'Tech Support', null],
  ['ops-manager@example.com', ['operations_manager'], 'Ops Manager', null],
]) {
  ids[email] = await ensureUser(email, roles, fullName, org);
  console.log(`Ready: ${email.padEnd(28)} ${roles.join(', ')}`);
}

const organiser = ids['organiser@example.com'];
const coordinator = ids['coordinator@example.com'];
const lead = ids['ops-manager@example.com'];
const venueStaff = ids['venue-staff@example.com'];
const techSupport = ids['tech-support@example.com'];

// --- Clear --------------------------------------------------------------------
// Events first: their bookings and reservations go with them, and a
// reservation holds its item.
check('clear S111 events', await supabase.from('event_request').delete().like('name', `${PREFIX} %`));
check('clear S111 projector', await supabase.from('equipment').delete().eq('name', PROJECTOR));

const { data: projector, error: projectorError } = await supabase
  .from('equipment')
  .insert({ name: PROJECTOR, category: 'av', quantity: 10, current_location: 'Bugis Store Room', created_by: techSupport })
  .select('id')
  .single();
if (projectorError) throw new Error(`projector: ${projectorError.message}`);

async function venueId(name) {
  const { data, error } = await supabase.from('venues').select('id').eq('name', name).single();
  if (error) throw new Error(`${name}: ${error.message} (run npm run db:reset first)`);
  return data.id;
}
const marinaBay = await venueId('Marina Bay Ballroom');
const bugis = await venueId('Bugis Seminar Room');

// --- Events -------------------------------------------------------------------
/**
 * Submitted, assigned, approved; then a booking requested (SCRUM-142, which
 * moves it to Planning) and approved by Venue Staff (SCRUM-148); then moved on
 * to `status` if that is not Planning.
 */
async function createEvent(name, { status = 'planning', date, start, end, attendance, venue }) {
  const { data: event, error } = await supabase
    .from('event_request')
    .insert({
      name,
      organiser_id: organiser,
      client_organisation_id: harbour,
      purpose: 'Client event',
      description: `${name}, test data for SCRUM-111`,
      proposed_date: date,
      start_time: start,
      end_time: end,
      expected_attendance: attendance,
      room_layout: 'banquet',
      accessibility_required: false,
    })
    .select('id')
    .single();
  if (error) throw new Error(`insert ${name}: ${error.message}`);

  for (const patch of [
    { status: 'submitted' },
    { coordinator_id: coordinator, assigned_by: lead },
    { status: 'approved', decision: 'approved', decided_by: coordinator },
  ]) {
    check(`${name} -> ${JSON.stringify(patch)}`, await supabase.from('event_request').update(patch).eq('id', event.id));
  }

  const { data: requestId, error: requestError } = await supabase.rpc('create_venue_booking_request', {
    p_event_request_id: event.id,
    p_venue_id: venue,
    p_requested_by: coordinator,
    p_lines: [{ date, start, end }],
  });
  if (requestError) throw new Error(`${name} booking request: ${requestError.message}`);
  const { data: line } = await supabase.from('venue_booking_request_line').select('id').eq('request_id', requestId).single();
  check(
    `${name} approve booking`,
    await supabase.rpc('decide_venue_booking_request', {
      p_request_id: requestId,
      p_decisions: [{ line_id: line.id, decision: 'approve' }],
      p_decided_by: venueStaff,
    }),
  );

  if (status !== 'planning') {
    check(`${name} -> ${status}`, await supabase.from('event_request').update({ status }).eq('id', event.id));
  }
  return event.id;
}

/** Projector P-100 x 2 for the event, reserved through reserve_equipment as Technical Support would. */
async function reserveProjector(eventId, name) {
  check('equipment request', await supabase.from('equipment_request').upsert({ event_request_id: eventId }, { onConflict: 'event_request_id' }));
  const { data: line, error } = await supabase
    .from('equipment_request_line')
    .insert({ event_request_id: eventId, equipment_id: projector.id, quantity: 2, created_by: coordinator })
    .select('id')
    .single();
  if (error) throw new Error(`${name} line: ${error.message}`);
  const { data, error: reserveError } = await supabase.rpc('reserve_equipment', {
    p_line_id: line.id,
    p_quantity: 2,
    p_reserved_by: techSupport,
  });
  if (reserveError || data?.outcome !== 'reserved') {
    throw new Error(`${name} reserve: ${reserveError?.message ?? JSON.stringify(data)}`);
  }
}

const galaDate = daysAhead(28);
const avDate = daysAhead(35);
const fullDate = daysAhead(42);
const tomorrow = daysAhead(1);

await createEvent(`${PREFIX} Harbour Gala`, { date: galaDate, start: '10:00', end: '12:00', attendance: 150, venue: marinaBay });
const avNight = await createEvent(`${PREFIX} AV Night`, { date: avDate, start: '19:00', end: '22:00', attendance: 80, venue: bugis });
await reserveProjector(avNight, 'AV Night');
await createEvent(`${PREFIX} Tomorrow Brief`, {
  status: 'confirmed',
  date: tomorrow,
  start: '10:00',
  end: '12:00',
  attendance: 40,
  venue: bugis,
});
const fullHouse = await createEvent(`${PREFIX} Full House`, { date: fullDate, start: '10:00', end: '12:00', attendance: 150, venue: marinaBay });
await reserveProjector(fullHouse, 'Full House');

const { data: events } = await supabase.from('event_request').select('id, reference, name, status').like('name', `${PREFIX} %`).order('name');
for (const event of events) console.log(`Event:  ${event.reference}  ${event.name.padEnd(22)} ${event.status.padEnd(10)} /events/${event.id}/review`);

console.log(`
Done. Password for every account: ${TEST_PASSWORD}
S111 Harbour Gala:   Marina Bay Ballroom, ${galaDate}, 10:00-12:00
S111 AV Night:       Bugis Seminar Room, ${avDate}, 19:00-22:00, ${PROJECTOR} x 2 reserved
S111 Tomorrow Brief: Bugis Seminar Room, ${tomorrow} (tomorrow), 10:00-12:00, Confirmed
S111 Full House:     Marina Bay Ballroom, ${fullDate}, 10:00-12:00, ${PROJECTOR} x 2 reserved`);
