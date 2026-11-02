// Seeds SCRUM-109's manual run (TC-109-01 to TC-109-13): the full event record
// as each related role sees it (AC1, AC2), and the Event Coordinator Lead's
// read-only view of the essential arrangements (AC3). Only what those test
// cases need, and nothing from other stories' seeds.
//
// Run: npm run db:start && npm run db:reset && npm run seed:users
//      node scripts/seed-scrum109.mjs             (no dev server needed)
//
// One group of events per AC, so the manual run goes AC1 to AC3 in order with
// nothing to re-seed between. Nothing in the run changes data.
//
// Safe to run again: the accounts are updated in place, and every "S109" event,
// venue and equipment item is deleted and recreated.
//
// Accounts, all with password TestPass123!:
//   organiser@             Event Organiser, Harbour Events Pte Ltd, owns every S109 event
//   organiser-colleague@   Event Organiser, Harbour Events Pte Ltd, owns none (TC-109-09)
//   organiser-other@       Event Organiser, Lion City Conferences (TC-109-04)
//   coordinator@           Event Coordinator assigned to every S109 event
//   coordinator-b@         Event Coordinator not assigned to any (TC-109-05)
//   ops-manager@           Event Coordinator Lead (TC-109-11 to 13)
//   venue-staff@           Venue Staff (TC-109-06, 10); approves the bookings
//   tech-support@          Technical Support Staff (TC-109-07, 10); reserves the equipment
//
// Events (all for organiser@, assigned to coordinator@; venue S109 Marina Bay
// Ballroom, item S109 Projector P-100):
//   AC1  S109 Harbour Gala     Confirmed: booked, Projector × 2 reserved, registration
//                              set (today to today + 14, capacity 250) (TC-109-01, 02, 04, 05)
//        S109 New Approval     Approved, nothing arranged yet (TC-109-03)
//   AC2  S109 Garden Launch    Confirmed, arranged as the Gala, internal notes
//                              "VIP table near stage" (TC-109-06 to 09)
//        S109 Unbooked Talk    Approved, no booking request; technical requirements
//                              saved but no item, so no equipment request raised (TC-109-10)
//   AC3  S109 Lead Review      Planning: booked, Projector × 2 not reserved, registration
//                              not set; venue, equipment and registration essential (TC-109-11, 13)
//        S109 Ready Dinner     Confirmed: all four essential, venue, equipment and
//                              registration complete (TC-109-12)
//        S109 Cancelled Talk   Cancelled with venue and registration essential and
//                              neither done; the Lead opens it as history (TC-109-14)
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_PASSWORD = 'TestPass123!';
const PREFIX = 'S109';
const ITEM = `${PREFIX} Projector P-100`;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script.');
}

// Creates accounts with a known password through the service-role key, so it
// refuses to run against anything but the local stack (same guard as
// scripts/seed-scrum185.mjs).
if (!['127.0.0.1', 'localhost'].includes(new URL(SUPABASE_URL).hostname)) {
  throw new Error(`NEXT_PUBLIC_SUPABASE_URL (${SUPABASE_URL}) is not a local Supabase instance; refusing to run.`);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function check(label, { error }) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

async function single(label, query) {
  const { data, error } = await query;
  if (error || !data) throw new Error(`${label}: ${error?.message ?? 'not found'}`);
  return data;
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

/** An account `npm run seed:users` creates, left as it is. */
async function existingUser(email) {
  const id = await userIdByEmail(email);
  if (!id) throw new Error(`${email} not found. Run npm run seed:users first.`);
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

// --- Organisations and accounts -------------------------------------------------
const harbour = await ensureOrganisation('Harbour Events Pte Ltd');
const lionCity = await ensureOrganisation('Lion City Conferences');

const organiser = await ensureUser('organiser@example.com', ['event_organiser'], 'Organiser', harbour);
const coordinator = await ensureUser('coordinator@example.com', ['coordinator'], 'Coordinator A');
// SCRUM-98's contact number, so the organiser's view shows it and Venue Staff's does not (TC-109-02, 06).
check('coordinator contact', await supabase.from('profiles').update({ contact_number: '+65 6123 4567' }).eq('id', coordinator));
await ensureUser('coordinator-b@example.com', ['coordinator'], 'Coordinator B');
await ensureUser('organiser-colleague@example.com', ['event_organiser'], 'Organiser Colleague', harbour);
await ensureUser('organiser-other@example.com', ['event_organiser'], 'Organiser Other', lionCity);
await existingUser('ops-manager@example.com');
const venueStaff = await existingUser('venue-staff@example.com');
const techSupport = await existingUser('tech-support@example.com');
console.log('Ready: organiser@, organiser-colleague@, organiser-other@, coordinator@, coordinator-b@, ops-manager@, venue-staff@, tech-support@');

// --- Clear the previous run ----------------------------------------------------------
// Events first: their bookings, lines and reservations go with them (cascade).
check('clear S109 events', await supabase.from('event_request').delete().like('name', `${PREFIX} %`));
check('clear S109 venues', await supabase.from('venues').delete().like('name', `${PREFIX} %`));
check('clear S109 item', await supabase.from('equipment').delete().eq('name', ITEM));

// --- The venue and the item ------------------------------------------------------------
const { data: marinaBay, error: locationError } = await supabase.from('locations').select('id').eq('name', 'Marina Bay').single();
if (locationError) throw new Error('Location "Marina Bay" not found. Run npm run db:reset first (supabase/seed.sql).');

const { data: ballroom, error: venueError } = await supabase.rpc('create_venue', {
  p_name: `${PREFIX} Marina Bay Ballroom`,
  p_location_id: marinaBay.id,
  p_max_capacity: 300,
  p_operating_slots: ['am', 'pm', 'night'],
  p_facility_ids: [],
  p_accessibility_feature_ids: [],
  p_layouts: [{ layout: 'theatre', capacity: 300 }],
  p_opens_at: '07:00',
  p_closes_at: '24:00',
});
if (venueError) throw new Error(`create venue: ${venueError.message}`);

const item = await single(
  ITEM,
  supabase
    .from('equipment')
    .insert({ name: ITEM, category: 'av', quantity: 10, current_location: 'Bugis store room', created_by: techSupport })
    .select('id')
    .single(),
);

// --- Events ---------------------------------------------------------------------------
/**
 * Submitted, assigned to coordinator@ and Approved, then arranged the way the
 * app arranges it: a booking requested by the coordinator and approved by
 * venue-staff@ (Approved → Planning), Projector P-100 × 2 requested and, when
 * `reserve`, reserved by tech-support@, the essential set recorded, and when
 * `confirm`, Confirmed with registration set (SCRUM-185 AC5).
 */
async function createEvent(name, days, { book = false, equipment = false, reserve = false, essential = [], internalNotes = null, confirm = false, requirementsOnly = false, cancel = false } = {}) {
  const date = daysAhead(days);
  const event = await single(
    `insert ${name}`,
    supabase
      .from('event_request')
      .insert({
        name,
        organiser_id: organiser,
        client_organisation_id: harbour,
        purpose: 'Client event',
        description: `${name}, test data for SCRUM-109`,
        proposed_date: date,
        start_time: '10:00',
        end_time: '12:00',
        expected_attendance: 150,
        room_layout: 'theatre',
        equipment_required: true,
        registration_required: true,
      })
      .select('id')
      .single(),
  );
  for (const patch of [
    { status: 'submitted' },
    { coordinator_id: coordinator, assigned_by: coordinator },
    { status: 'approved', decision: 'approved', decided_by: coordinator },
  ]) {
    check(`prepare ${name}`, await supabase.from('event_request').update(patch).eq('id', event.id));
  }

  if (book) {
    const { data: requestId, error } = await supabase.rpc('create_venue_booking_request', {
      p_event_request_id: event.id,
      p_venue_id: ballroom,
      p_requested_by: coordinator,
      p_lines: [{ date, start: '10:00', end: '12:00' }],
    });
    if (error) throw new Error(`request ${name}: ${error.message}`);
    const line = await single(`line ${name}`, supabase.from('venue_booking_request_line').select('id').eq('request_id', requestId).single());
    check(
      `approve ${name}`,
      await supabase.rpc('decide_venue_booking_request', {
        p_request_id: requestId,
        p_decisions: [{ line_id: line.id, decision: 'approve', reason: null, suggestion: null }],
        p_decided_by: venueStaff,
      }),
    );
  }

  if (equipment) {
    check(`equipment request ${name}`, await supabase.from('equipment_request').upsert({ event_request_id: event.id }, { onConflict: 'event_request_id' }));
    const line = await single(
      `equipment line ${name}`,
      supabase
        .from('equipment_request_line')
        .insert({ event_request_id: event.id, equipment_id: item.id, quantity: 2, created_by: coordinator })
        .select('id')
        .single(),
    );
    if (reserve) {
      check(`reserve ${name}`, await supabase.from('equipment_reservation').insert({ line_id: line.id, quantity: 2, reserved_by: techSupport }));
    }
  }

  if (requirementsOnly) {
    // A request is raised by its first item (SCRUM-160 AC10); this one has none.
    check(`requirements ${name}`, await supabase.from('equipment_request').upsert({ event_request_id: event.id, technical_requirements: 'Lectern mic' }, { onConflict: 'event_request_id' }));
  }

  if (essential.length > 0) {
    const { data: outcome, error } = await supabase.rpc('record_essential_arrangements', {
      p_event_request_id: event.id,
      p_recorded_by: coordinator,
      p_venue: essential.includes('venue'),
      p_equipment: essential.includes('equipment'),
      p_technical_support: essential.includes('technicalSupport'),
      p_registration: essential.includes('registration'),
    });
    if (error || outcome !== 'recorded') throw new Error(`essential ${name}: ${error?.message ?? outcome}`);
  }

  if (internalNotes) {
    check(
      `internal ${name}`,
      await supabase
        .from('event_request')
        .update({ internal_notes: internalNotes, client_contact_name: 'Mei Lin Tan', client_contact_email: 'meilin@harbourevents.example.com' })
        .eq('id', event.id),
    );
  }

  if (confirm) {
    check(`confirm ${name}`, await supabase.from('event_request').update({ status: 'confirmed' }).eq('id', event.id));
    check(
      `registration ${name}`,
      await supabase
        .from('event_request')
        .update({ registration_start_date: daysAhead(0), registration_end_date: daysAhead(14), registration_capacity: 250 })
        .eq('id', event.id),
    );
  }
  if (cancel) {
    check(`cancel ${name}`, await supabase.from('event_request').update({ status: 'cancelled', cancellation_reason: 'Client called off the event', cancelled_by: coordinator, cancelled_at: new Date().toISOString() }).eq('id', event.id));
  }
  return event.id;
}

const arranged = { book: true, equipment: true, reserve: true, confirm: true };
const allFour = ['venue', 'equipment', 'technicalSupport', 'registration'];

// AC1
await createEvent(`${PREFIX} Harbour Gala`, 40, { ...arranged, essential: allFour, internalNotes: 'VIP table near stage' });
await createEvent(`${PREFIX} New Approval`, 41);
// AC2
await createEvent(`${PREFIX} Garden Launch`, 42, { ...arranged, essential: allFour, internalNotes: 'VIP table near stage' });
await createEvent(`${PREFIX} Unbooked Talk`, 43, { requirementsOnly: true });
// AC3
await createEvent(`${PREFIX} Lead Review`, 44, { book: true, equipment: true, essential: ['venue', 'equipment', 'registration'] });
await createEvent(`${PREFIX} Ready Dinner`, 45, { ...arranged, essential: allFour });
await createEvent(`${PREFIX} Cancelled Talk`, 46, { essential: ['venue', 'registration'], cancel: true });

const { data: events } = await supabase.from('event_request').select('id, reference, name, status, proposed_date').like('name', `${PREFIX} %`).order('proposed_date');
for (const event of events) {
  console.log(`Event:  ${event.reference}  ${event.name.padEnd(19)} ${event.status.padEnd(10)} /events/${event.id}/record`);
}

console.log(`\nDone. Password for every account: ${TEST_PASSWORD}`);
