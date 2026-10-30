// Seeds SCRUM-253's manual run (TC-253-01 to TC-253-04): Venue Staff Navigation.
//
// Run: npm run db:start && npm run db:reset && npm run seed:users
//      node scripts/seed-scrum253.mjs          (no dev server needed)
//
// Safe to run again: the accounts are updated in place, and the SCRUM-253
// event (its requests and lines go with it) is deleted and recreated.
//
// Account, password TestPass123!:
//   venue-staff@example.com   {venue_staff}     TC-253-01 to 04
//
// Data the test cases open:
//   TC-253-03  two pending booking request lines, at Bugis Seminar Room and
//              Marina Bay Ballroom, so Booking requests has rows to open.
//   TC-253-04  the seeded venues (supabase/seed.sql): open one from Venues,
//              then its Edit and Calendar pages.
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local'), quiet: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_PASSWORD = 'TestPass123!';
const EVENT_NAME = 'SCRUM-253 Venue Staff nav test';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local before running this script.');
}

// Creates accounts with a known password through the service-role key, so it
// refuses to run against anything but the local stack.
if (!['127.0.0.1', 'localhost'].includes(new URL(SUPABASE_URL).hostname)) {
  throw new Error(`NEXT_PUBLIC_SUPABASE_URL (${SUPABASE_URL}) is not a local Supabase instance; refusing to run.`);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function check(label, { error }) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

async function single(label, query) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  if (!data) throw new Error(`${label}: not found.`);
  return data;
}

async function userIdByEmail(email) {
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((user) => user.email === email)?.id;
}

/** Creates the account if missing, then sets its roles and name. */
async function ensureUser(email, roles, fullName) {
  const { error } = await supabase.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });
  if (error && !error.message.toLowerCase().includes('already been registered')) {
    throw new Error(`create ${email}: ${error.message}`);
  }
  const id = await userIdByEmail(email);
  if (!id) throw new Error(`${email} not found after creating it.`);
  check(`profile ${email}`, await supabase.from('profiles').update({ roles, full_name: fullName }).eq('id', id));
  return id;
}

// --- Accounts ---------------------------------------------------------------
await ensureUser('venue-staff@example.com', ['venue_staff'], 'Venue Staff');
const coordinator = await ensureUser('coordinator@example.com', ['coordinator'], 'Coordinator A');
const organiser = await ensureUser('organiser@example.com', ['event_organiser'], 'Organiser');
const opsManager = await ensureUser('ops-manager@example.com', ['operations_manager'], 'Ops Manager');
console.log(`Ready: venue-staff@example.com {venue_staff}  (password ${TEST_PASSWORD})\n`);

// --- Event with two pending booking request lines (TC-253-03) -----------------
check('clear previous event', await supabase.from('event_request').delete().eq('name', EVENT_NAME));

const now = new Date().toISOString();
const event = await single(
  'insert event',
  supabase
    .from('event_request')
    .insert({
      name: EVENT_NAME,
      purpose: 'SCRUM-253 manual test',
      description: 'Seeded by scripts/seed-scrum253.mjs',
      organiser_id: organiser,
      status: 'planning',
      proposed_date: '2026-12-10',
      start_time: '10:00',
      end_time: '12:00',
      expected_attendance: 50,
      submitted_at: now,
      decision: 'approved',
      decided_by: opsManager,
      decided_at: now,
      coordinator_id: coordinator,
      assigned_by: opsManager,
      assigned_at: now,
    })
    .select('id, reference')
    .single(),
);

const REQUESTS = [
  { venue: 'Bugis Seminar Room', date: '2026-12-10' },
  { venue: 'Marina Bay Ballroom', date: '2026-12-11' },
];

for (const { venue, date } of REQUESTS) {
  const { id: venueId } = await single(
    `venue ${venue}`,
    supabase.from('venues').select('id').eq('name', venue).maybeSingle(),
  );
  const request = await single(
    `booking request ${venue}`,
    supabase
      .from('venue_booking_request')
      .insert({ event_request_id: event.id, venue_id: venueId, requested_by: coordinator })
      .select('id')
      .single(),
  );
  check(
    `booking request line ${venue}`,
    await supabase
      .from('venue_booking_request_line')
      .insert({ request_id: request.id, date, start_time: '10:00', end_time: '12:00' }),
  );
  console.log(`  ${event.reference}  ${date} 10:00-12:00  ${venue.padEnd(22)} /venue-booking-requests/${request.id}`);
}
