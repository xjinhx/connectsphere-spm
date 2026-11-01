// Seeds SCRUM-105's manual run (TC-105-01 to TC-105-19): cancel an event at
// any stage. Only what those test cases need.
//
// Run: npm run db:start && npm run db:reset   (seed.sql gives the three venues)
//      node scripts/seed-scrum105.mjs          (no dev server needed)
//
// Safe to run again: the accounts are updated in place, and every "S105" event
// (with its bookings, reservations, registrations and notifications) is
// deleted and recreated, as is the item EQ-105-01.
//
// Accounts, all with password TestPass123!:
//   coordinator@ ("Coordinator A")  coordinates E105-A to F
//   coordinator2@ ("Coordinator B") coordinates E105-X and Y (TC-105-06, 16)
//   ops-manager@ ("Ops Manager")    the Event Coordinator Lead (TC-105-07)
//   organiser@ ("Organiser")        organiser of every S105 event (TC-105-12)
//   venue-staff@ ("Venue Staff")    approved E105-A's bookings (TC-105-13, 18)
//   tech-support@ ("Tech Support")  reserved E105-A's equipment (TC-105-13)
//   attendee@ ("Attendee")          registered for E105-A (TC-105-14)
//
// Events (all on or after 12/11/2026, 10:00 to 12:00):
//   E105-A  Planning. Confirmed bookings at Marina Bay Ballroom 12/11/2026 and
//           Bugis Seminar Room 13/11/2026, approved by venue-staff@; 3 of
//           EQ-105-01 (quantity 5) reserved by tech-support@; attendee@ registered.
//   E105-B  Submitted, nothing arranged (TC-105-02, 15)
//   E105-C  Preparation, booked at Jurong East Training Room 14/11/2026 (TC-105-03)
//   E105-D1 Completed, D2 Rejected, D3 Cancelled (TC-105-05)
//   E105-E  Planning, a Pending line at Bugis Seminar Room 20/11/2026 (TC-105-11)
//   E105-F  Planning, nothing arranged (TC-105-04, 06, 07)
//   E105-X  Planning, coordinator2@, booked at Jurong East Training Room
//           12/11/2026, asks for 4 of EQ-105-01 (TC-105-09: 2 available, 5 after)
//   E105-Y  Planning, coordinator2@, a Pending line at Marina Bay Ballroom
//           12/11/2026 10:00 to 12:00, clashing with E105-A (TC-105-19)
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_PASSWORD = 'TestPass123!';
const PREFIX = 'S105';
const ITEM = 'EQ-105-01';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local before running this script.');
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

async function single(label, query) {
  const { data, error } = await query;
  if (error || !data) throw new Error(`${label}: ${error?.message ?? 'no row'}`);
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
const coordinator = await ensureUser('coordinator@example.com', ['coordinator'], 'Coordinator A');
const coordinator2 = await ensureUser('coordinator2@example.com', ['coordinator'], 'Coordinator B');
const lead = await ensureUser('ops-manager@example.com', ['operations_manager'], 'Ops Manager');
const organiser = await ensureUser('organiser@example.com', ['event_organiser'], 'Organiser');
const venueStaff = await ensureUser('venue-staff@example.com', ['venue_staff'], 'Venue Staff');
const techSupport = await ensureUser('tech-support@example.com', ['technical_support'], 'Tech Support');
const attendee = await ensureUser('attendee@example.com', ['attendee'], 'Attendee');

// --- Clear the last run ---------------------------------------------------------
const { data: old } = await supabase.from('event_request').select('id').like('name', `${PREFIX} %`);
const oldIds = (old ?? []).map((row) => row.id);
if (oldIds.length > 0) {
  check('clear S105 notifications', await supabase.from('notifications').delete().in('event_request_id', oldIds));
  check('clear S105 events', await supabase.from('event_request').delete().in('id', oldIds));
}
check('clear EQ-105-01', await supabase.from('equipment').delete().eq('name', ITEM));

// --- Venues and the item -----------------------------------------------------------
async function venueId(name) {
  return (await single(`venue ${name}`, supabase.from('venues').select('id').eq('name', name).single())).id;
}
const ballroom = await venueId('Marina Bay Ballroom');
const seminarRoom = await venueId('Bugis Seminar Room');
const trainingRoom = await venueId('Jurong East Training Room');

const item = await single(
  ITEM,
  supabase
    .from('equipment')
    .insert({ name: ITEM, category: 'av', quantity: 5, current_location: 'Bugis store room', created_by: techSupport })
    .select('id')
    .single(),
);

// --- Events ---------------------------------------------------------------------
async function createEvent(key, status, coordinatorId = coordinator, date = '2026-11-12') {
  const now = new Date().toISOString();
  const decided = status !== 'submitted';
  return (
    await single(
      `event ${key}`,
      supabase
        .from('event_request')
        .insert({
          organiser_id: organiser,
          name: `${PREFIX} ${key}`,
          proposed_date: date,
          start_time: '10:00',
          end_time: '12:00',
          expected_attendance: 50,
          status,
          submitted_at: now,
          decision: decided ? (status === 'rejected' ? 'rejected' : 'approved') : null,
          rejection_reason: status === 'rejected' ? 'Date clashes with a client blackout' : null,
          decided_by: decided ? coordinatorId : null,
          decided_at: decided ? now : null,
          coordinator_id: coordinatorId,
          assigned_by: lead,
          assigned_at: now,
        })
        .select('id, reference')
        .single(),
    )
  );
}

/** A booking request line at `venue` on `date`, 10:00 to 12:00: Pending, or approved by venue-staff@ with its booking. */
async function line(eventId, venue, date, { approved, requestedBy = coordinator }) {
  const request = await single(
    'booking request',
    supabase.from('venue_booking_request').insert({ event_request_id: eventId, venue_id: venue, requested_by: requestedBy }).select('id').single(),
  );
  const now = new Date().toISOString();
  const row = await single(
    'booking request line',
    supabase
      .from('venue_booking_request_line')
      .insert({
        request_id: request.id,
        date,
        start_time: '10:00',
        end_time: '12:00',
        status: approved ? 'approved' : 'pending',
        decided_by: approved ? venueStaff : null,
        decided_at: approved ? now : null,
      })
      .select('id')
      .single(),
  );
  if (approved) {
    check(
      'booking',
      await supabase.from('venue_booking').insert({
        event_request_id: eventId,
        venue_id: venue,
        date,
        start_time: '10:00',
        end_time: '12:00',
        request_line_id: row.id,
      }),
    );
  }
}

/** `quantity` of EQ-105-01 asked for, and reserved by tech-support@ when `reserved`. */
async function equipment(eventId, quantity, reserved) {
  check('equipment request', await supabase.from('equipment_request').upsert({ event_request_id: eventId }, { onConflict: 'event_request_id' }));
  const requestLine = await single(
    'equipment line',
    supabase
      .from('equipment_request_line')
      .insert({ event_request_id: eventId, equipment_id: item.id, quantity, created_by: coordinator })
      .select('id')
      .single(),
  );
  if (reserved) {
    check(
      'reservation',
      await supabase.from('equipment_reservation').insert({ line_id: requestLine.id, quantity, reserved_by: techSupport }),
    );
  }
}

const created = [];

const a = await createEvent('E105-A', 'planning');
await line(a.id, ballroom, '2026-11-12', { approved: true });
await line(a.id, seminarRoom, '2026-11-13', { approved: true });
await equipment(a.id, 3, true);
check(
  'registration',
  await supabase.from('event_registration').insert({
    event_request_id: a.id,
    attendee_id: attendee,
    full_name: 'Attendee',
    email: 'attendee@example.com',
    contact_number: '91234567',
  }),
);
created.push(['E105-A', a]);

created.push(['E105-B', await createEvent('E105-B', 'submitted')]);

const c = await createEvent('E105-C', 'preparation', coordinator, '2026-11-14');
await line(c.id, trainingRoom, '2026-11-14', { approved: true });
created.push(['E105-C', c]);

created.push(['E105-D1', await createEvent('E105-D1', 'completed')]);
created.push(['E105-D2', await createEvent('E105-D2', 'rejected')]);
created.push(['E105-D3', await createEvent('E105-D3', 'cancelled')]);

const e = await createEvent('E105-E', 'planning', coordinator, '2026-11-20');
await line(e.id, seminarRoom, '2026-11-20', { approved: false });
created.push(['E105-E', e]);

created.push(['E105-F', await createEvent('E105-F', 'planning')]);

const x = await createEvent('E105-X', 'planning', coordinator2);
await line(x.id, trainingRoom, '2026-11-12', { approved: true, requestedBy: coordinator2 });
await equipment(x.id, 4, false);
created.push(['E105-X', x]);

const y = await createEvent('E105-Y', 'planning', coordinator2);
await line(y.id, ballroom, '2026-11-12', { approved: false, requestedBy: coordinator2 });
created.push(['E105-Y', y]);

console.log('SCRUM-105 events (coordinator@example.com coordinates A to F, coordinator2@example.com X and Y):');
for (const [key, event] of created) {
  console.log(`  ${event.reference}  ${key.padEnd(7)} http://localhost:3000/events/${event.id}/review`);
}
console.log(`\n${ITEM}: quantity 5; E105-A holds 3, E105-X asks for 4.`);
console.log('Password for every account: TestPass123!');
