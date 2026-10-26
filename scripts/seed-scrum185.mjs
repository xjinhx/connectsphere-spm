// Seeds SCRUM-185's manual run for AC5 and AC6 (TC-185-01 to TC-185-06): the
// coordinator setting an event's registration start date, end date and
// capacity. Only what those test cases need, and nothing from other stories'
// seeds.
//
// Run: npm run db:start && npm run db:reset
//      node scripts/seed-scrum185.mjs          (no dev server needed)
//
// Safe to run again: the accounts are updated in place, and every "S185" event
// and venue is deleted and recreated.
//
// Accounts, all with password TestPass123!:
//   organiser@       Event Organiser, Harbour Events Pte Ltd, who owns every S185 event
//   coordinator@     Event Coordinator assigned to every S185 event
//   coordinator-b@   Event Coordinator not assigned to any (TC-185-03)
//
// Venues:
//   S185 Marina Bay Ballroom   capacity 300
//   S185 Bugis Seminar Room    capacity 200
//
// Events:
//   S185 Harbour Gala     Confirmed, booked at the Ballroom (TC-185-01, 03, 04, 05)
//   S185 Planning Talk    Planning, booked at the Ballroom (TC-185-02)
//   S185 Two Hall Expo    Confirmed, booked at both venues (TC-185-06)
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_PASSWORD = 'TestPass123!';
const PREFIX = 'S185';

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
await ensureUser('coordinator-b@example.com', ['coordinator'], 'Coordinator B');
console.log('Ready: organiser@example.com, coordinator@example.com, coordinator-b@example.com');

// --- Clear the previous run ----------------------------------------------------
// Events first: their bookings go with them (cascade).
check('clear S185 events', await supabase.from('event_request').delete().like('name', `${PREFIX} %`));
check('clear S185 venues', await supabase.from('venues').delete().like('name', `${PREFIX} %`));

// --- Venues, through the same database function as the add venue form ---------
const { data: marinaBay, error: locationError } = await supabase.from('locations').select('id').eq('name', 'Marina Bay').single();
if (locationError) throw new Error('Location "Marina Bay" not found. Run npm run db:reset first (supabase/seed.sql).');

async function createVenue(name, max) {
  const { data, error } = await supabase.rpc('create_venue', {
    p_name: name,
    p_location_id: marinaBay.id,
    p_max_capacity: max,
    p_operating_slots: ['am', 'pm', 'night'],
    p_facility_ids: [],
    p_accessibility_feature_ids: [],
    p_layouts: [{ layout: 'theatre', capacity: max }],
    p_opens_at: '07:00',
    p_closes_at: '24:00',
  });
  if (error) throw new Error(`create ${name}: ${error.message}`);
  console.log(`Venue:  ${name.padEnd(26)} capacity ${max}`);
  return data;
}

const ballroom = await createVenue(`${PREFIX} Marina Bay Ballroom`, 300);
const seminarRoom = await createVenue(`${PREFIX} Bugis Seminar Room`, 200);

// --- Events ---------------------------------------------------------------------
/** Submitted, assigned to coordinator@, Approved, then on to `status`, with a confirmed booking at each venue. */
async function createEvent(name, date, status, venues) {
  const { data, error } = await supabase
    .from('event_request')
    .insert({
      name,
      organiser_id: organiser,
      client_organisation_id: harbour,
      purpose: 'Client event',
      description: `${name}, test data for SCRUM-185`,
      proposed_date: date,
      start_time: '10:00',
      end_time: '12:00',
      expected_attendance: 150,
      registration_required: true,
    })
    .select('id')
    .single();
  if (error) throw new Error(`insert ${name}: ${error.message}`);
  const steps = [
    { status: 'submitted' },
    { coordinator_id: coordinator, assigned_by: coordinator },
    { status: 'approved', decision: 'approved', decided_by: coordinator },
    { status: 'planning' },
  ];
  for (const patch of steps) check(`prepare ${name}`, await supabase.from('event_request').update(patch).eq('id', data.id));
  for (const venueId of venues) {
    check(
      `book ${name}`,
      await supabase.from('venue_booking').insert({
        venue_id: venueId,
        event_request_id: data.id,
        date,
        start_time: '10:00',
        end_time: '12:00',
        status: 'confirmed',
      }),
    );
  }
  if (status === 'confirmed') {
    check(`confirm ${name}`, await supabase.from('event_request').update({ status: 'confirmed' }).eq('id', data.id));
  }
  return data.id;
}

await createEvent(`${PREFIX} Harbour Gala`, daysAhead(30), 'confirmed', [ballroom]);
await createEvent(`${PREFIX} Planning Talk`, daysAhead(31), 'planning', [ballroom]);
await createEvent(`${PREFIX} Two Hall Expo`, daysAhead(32), 'confirmed', [ballroom, seminarRoom]);

const { data: events } = await supabase.from('event_request').select('id, reference, name, status').like('name', `${PREFIX} %`).order('name');
for (const event of events) {
  console.log(`Event:  ${event.reference}  ${event.name.padEnd(20)} ${event.status.padEnd(10)} /events/${event.id}/registrations`);
}

console.log(`\nDone. Password for every account: ${TEST_PASSWORD}`);
