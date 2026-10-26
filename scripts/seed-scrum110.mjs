// Seeds SCRUM-110's manual run (TC-110-01 to TC-110-11): edit ordinary event
// information. Only what those test cases need, and nothing from other
// stories' seeds.
//
// Run: npm run db:start && npm run db:reset   (seed.sql gives Marina Bay Ballroom)
//      node scripts/seed-scrum110.mjs          (no dev server needed)
//
// Safe to run again: the accounts are updated in place, and every "S110" event
// (with its booking) is deleted and recreated.
//
// Accounts, all with password TestPass123!:
//   organiser@             Event Organiser, Harbour Events Pte Ltd, responsible for every S110 event
//   organiser-colleague@   Event Organiser, Harbour Events Pte Ltd, not responsible (TC-110-08)
//   organiser-other@       Event Organiser, Lion City Conferences (TC-110-09)
//   coordinator@           Event Coordinator, assigned to every S110 event except the draft
//   coordinator-b@         Event Coordinator, not assigned (TC-110-03)
//   venue-staff@           Venue Staff, who approved the Marina Bay Ballroom booking
//   ops-manager@           Event Coordinator Lead, who assigned the coordinator
//
// Events (dates two weeks or more ahead):
//   S110 Harbour Gala      Planning, approved booking at Marina Bay Ballroom 10:00-12:00 (TC-110-01, 03 to 06, 08, 09)
//   S110 Confirmed Dinner  Confirmed (TC-110-02)
//   S110 Draft Breakfast   Draft, not submitted, no coordinator (TC-110-07)
//   S110 Spring Forum      Completed (TC-110-10)
//   S110 Cancelled Launch  Cancelled (TC-110-11)
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_PASSWORD = 'TestPass123!';
const PREFIX = 'S110';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script.');
}

// Creates accounts with a known password through the service-role key, so it
// refuses to run against anything but the local stack (same guard as
// scripts/seed-scrum249.mjs).
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

function daysAhead(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// --- Organisations and accounts ---------------------------------------------
const harbour = await ensureOrganisation('Harbour Events Pte Ltd');
const lionCity = await ensureOrganisation('Lion City Conferences');

const ids = {};
for (const [email, roles, fullName, org] of [
  ['organiser@example.com', ['event_organiser'], 'Organiser', harbour],
  ['organiser-colleague@example.com', ['event_organiser'], 'Organiser Colleague', harbour],
  ['organiser-other@example.com', ['event_organiser'], 'Other Organiser', lionCity],
  ['coordinator@example.com', ['coordinator'], 'Coordinator A', null],
  ['coordinator-b@example.com', ['coordinator'], null, null],
  ['venue-staff@example.com', ['venue_staff'], null, null],
  ['ops-manager@example.com', ['operations_manager'], 'Ops Manager', null],
]) {
  ids[email] = await ensureUser(email, roles, fullName, org);
  console.log(`Ready: ${email.padEnd(32)} ${roles.join(', ')}`);
}

const organiser = ids['organiser@example.com'];
const coordinator = ids['coordinator@example.com'];
const lead = ids['ops-manager@example.com'];
const venueStaff = ids['venue-staff@example.com'];

// --- Events -----------------------------------------------------------------
check('clear S110 events', await supabase.from('event_request').delete().like('name', `${PREFIX} %`));

/** Drafted, then (unless 'draft') submitted, assigned, approved and moved on to `status`. */
async function createEvent(name, status, date) {
  const { data: event, error } = await supabase
    .from('event_request')
    .insert({
      name,
      organiser_id: organiser,
      client_organisation_id: harbour,
      purpose: 'Client event',
      description: `${name}, test data for SCRUM-110`,
      proposed_date: date,
      start_time: '10:00',
      end_time: '12:00',
      expected_attendance: 150,
    })
    .select('id')
    .single();
  if (error) throw new Error(`insert ${name}: ${error.message}`);
  if (status === 'draft') return event.id;

  const steps = [
    { status: 'submitted' },
    { coordinator_id: coordinator, assigned_by: lead },
    { status: 'approved', decision: 'approved', decided_by: coordinator },
  ];
  if (status !== 'approved') steps.push({ status });
  for (const patch of steps) check(`${name} -> ${JSON.stringify(patch)}`, await supabase.from('event_request').update(patch).eq('id', event.id));
  return event.id;
}

const galaDate = daysAhead(28);
const gala = await createEvent(`${PREFIX} Harbour Gala`, 'approved', galaDate);
await createEvent(`${PREFIX} Confirmed Dinner`, 'confirmed', daysAhead(35));
await createEvent(`${PREFIX} Draft Breakfast`, 'draft', daysAhead(42));
await createEvent(`${PREFIX} Spring Forum`, 'completed', daysAhead(14));
await createEvent(`${PREFIX} Cancelled Launch`, 'cancelled', daysAhead(21));

// The gala's booking, the real way: SCRUM-142's request (which moves the event
// to Planning) and Venue Staff's approval (SCRUM-148).
const { data: venue, error: venueError } = await supabase.from('venues').select('id').eq('name', 'Marina Bay Ballroom').single();
if (venueError) throw new Error(`Marina Bay Ballroom: ${venueError.message} (run npm run db:reset first)`);
const { data: requestId, error: requestError } = await supabase.rpc('create_venue_booking_request', {
  p_event_request_id: gala,
  p_venue_id: venue.id,
  p_requested_by: coordinator,
  p_lines: [{ date: galaDate, start: '10:00', end: '12:00' }],
});
if (requestError) throw new Error(`booking request: ${requestError.message}`);
const { data: line } = await supabase.from('venue_booking_request_line').select('id').eq('request_id', requestId).single();
check(
  'approve booking',
  await supabase.rpc('decide_venue_booking_request', {
    p_request_id: requestId,
    p_decisions: [{ line_id: line.id, decision: 'approve' }],
    p_decided_by: venueStaff,
  }),
);

const { data: events } = await supabase.from('event_request').select('reference, name, status').like('name', `${PREFIX} %`).order('name');
for (const event of events) console.log(`Event:  ${event.reference}  ${event.name.padEnd(24)} ${event.status}`);

console.log(`
Done. Password for every account: ${TEST_PASSWORD}
S110 Harbour Gala has an approved booking at Marina Bay Ballroom on ${galaDate}, 10:00-12:00.`);
