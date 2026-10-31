// Seeds SCRUM-251's manual run (TC-251-01 to TC-251-11): the Event Coordinator
// nav and back links. Only what those test cases need, and nothing from other
// stories' seeds.
//
// Run: npm run db:start && npm run db:reset && npm run seed:users
//      node scripts/seed-scrum251.mjs          (no dev server needed)
//
// Safe to run again: the accounts are updated in place, and every "S251" event
// is deleted and recreated.
//
// Accounts, all with password TestPass123!:
//   coordinator@     Event Coordinator assigned to both S251 events
//   coord-tech@      Event Coordinator and Technical Support Staff (TC-251-04)
//   organiser@       Event Organiser, Harbour Events Pte Ltd, who owns both events (TC-251-05)
//   venue-staff@     Venue Staff (TC-251-09)
//
// Client organisation: Harbour Events Pte Ltd (TC-251-03, TC-251-11)
// Venue: Marina Bay Ballroom, from supabase/seed.sql (TC-251-10)
//
// Events:
//   S251 Harbour Gala      Submitted, so it is on Review queue (TC-251-06)
//   S251 Confirmed Dinner  Confirmed, on My events, with a Pending booking
//                          request at Marina Bay Ballroom (TC-251-06 to 09)
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_PASSWORD = 'TestPass123!';
const PREFIX = 'S251';

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
const organiser = await ensureUser('organiser@example.com', ['event_organiser'], 'Organiser', harbour);
const coordinator = await ensureUser('coordinator@example.com', ['coordinator'], 'Coordinator A');
await ensureUser('coord-tech@example.com', ['coordinator', 'technical_support'], 'Coordinator Tech');
await ensureUser('venue-staff@example.com', ['venue_staff'], 'Venue Staff');
console.log('Ready: coordinator@, coord-tech@, organiser@, venue-staff@');

// --- Clear the previous run ----------------------------------------------------
// Events first: their booking requests go with them (cascade).
check('clear S251 events', await supabase.from('event_request').delete().like('name', `${PREFIX} %`));

const { data: ballroom, error: venueError } = await supabase.from('venues').select('id').eq('name', 'Marina Bay Ballroom').single();
if (venueError) throw new Error('Venue "Marina Bay Ballroom" not found. Run npm run db:reset first (supabase/seed.sql).');

// --- Events ---------------------------------------------------------------------
/** Submitted by organiser@ and assigned to coordinator@; then each later status in `then`. */
async function createEvent(name, date, then = []) {
  const { data, error } = await supabase
    .from('event_request')
    .insert({
      name,
      organiser_id: organiser,
      client_organisation_id: harbour,
      purpose: 'Client event',
      description: `${name}, test data for SCRUM-251`,
      proposed_date: date,
      start_time: '10:00',
      end_time: '12:00',
      expected_attendance: 150,
    })
    .select('id')
    .single();
  if (error) throw new Error(`insert ${name}: ${error.message}`);
  const steps = [{ status: 'submitted' }, { coordinator_id: coordinator, assigned_by: coordinator }, ...then];
  for (const patch of steps) check(`prepare ${name}`, await supabase.from('event_request').update(patch).eq('id', data.id));
  return data.id;
}

await createEvent(`${PREFIX} Harbour Gala`, daysAhead(30));

const dinnerDate = daysAhead(31);
const dinner = await createEvent(`${PREFIX} Confirmed Dinner`, dinnerDate, [
  { status: 'approved', decision: 'approved', decided_by: coordinator },
  { status: 'planning' },
]);
// The booking request is made the real way (SCRUM-142), while the event is in
// Planning, and left Pending so it is also on Venue Staff's queue (TC-251-09).
const { data: requestId, error: requestError } = await supabase.rpc('create_venue_booking_request', {
  p_event_request_id: dinner,
  p_venue_id: ballroom.id,
  p_requested_by: coordinator,
  p_lines: [{ date: dinnerDate, start: '10:00', end: '12:00' }],
});
if (requestError || !requestId) throw new Error(`booking request: ${requestError?.message ?? 'none returned'}`);
check('confirm S251 Confirmed Dinner', await supabase.from('event_request').update({ status: 'confirmed' }).eq('id', dinner));

const { data: events } = await supabase.from('event_request').select('id, reference, name, status').like('name', `${PREFIX} %`).order('name');
for (const event of events) {
  console.log(`Event:  ${event.reference}  ${event.name.padEnd(22)} ${event.status.padEnd(10)} /events/${event.id}/review`);
}
console.log(`Booking request: /venue-booking-requests/${requestId}`);
console.log(`Organisation:    /organisations/${harbour}`);
console.log(`\nDone. Password for every account: ${TEST_PASSWORD}`);
