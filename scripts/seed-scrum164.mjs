// Seeds SCRUM-164's manual run (TC-164-01 to TC-164-15): the equipment request
// queue. Needs the 20261018174009 migration applied (`npm run db:reset` after
// pulling it). Steps, in the order the manual run uses them:
//
//   node scripts/seed-scrum164.mjs                   Fixture F: EVT-A to EVT-E (resets everything)
//   node scripts/seed-scrum164.mjs reserve-mic       TC-164-12: EVT-C's Mic is reserved, 1 item left unavailable
//   node scripts/seed-scrum164.mjs reserve-lectern   TC-164-09: EVT-C's Lectern is reserved, EVT-C fulfilled
//   node scripts/seed-scrum164.mjs add-year-end      TC-164-05: EVT-H (28 Dec 2026) and EVT-G (3 Jan 2027)
//   node scripts/seed-scrum164.mjs add-tampines      TC-164-15: new location Tampines, venue Tampines Hall, EVT-I
//
// Every event is in Planning, assigned to coordinator@example.com, with a
// confirmed booking at a seeded venue in its location: Bugis Seminar Room
// (Bugis), Marina Bay Ballroom (Marina Bay), Jurong East Training Room (Jurong
// East).
//
// Statuses and unavailable lines are fixture data, written straight to the
// table so every run starts from the same queue (Technical Support Staff set
// them in the app since SCRUM-166, which replaced D-19). A reserved line is a row in
// equipment_reservation - DUMMY(SCRUM-167) D-18.
//
// The default step is safe to run again: every SCRUM-164 event (their requests,
// lines and bookings go with them), Tampines Hall and the Tampines location are
// deleted and Fixture F is recreated.
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local before running this script.',
  );
}

const supabase = createClient(supabaseUrl, serviceRoleKey);
const TEST_PASSWORD = 'TestPass123!';
const PREFIX = 'SCRUM-164';
const STEPS = ['fixture', 'reserve-mic', 'reserve-lectern', 'add-year-end', 'add-tampines'];
const step = process.argv[2] ?? 'fixture';
if (!STEPS.includes(step)) throw new Error(`Unknown step "${step}". One of: ${STEPS.join(', ')}.`);

function check(label, { error }) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

async function single(label, query) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  if (!data) throw new Error(`${label}: not found. Run the default step first.`);
  return data;
}

async function userIdByEmail(email) {
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((user) => user.email === email)?.id;
}

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
const techSupport = await ensureUser('tech-support@example.com', ['technical_support'], 'Tech Support');
// TC-164-14, TC-164-15: a second Technical Support Staff member.
await ensureUser('tech-support-2@example.com', ['technical_support'], 'Tech Support 2');
const organiser = await ensureUser('organiser@example.com', ['event_organiser'], 'Organiser');
const opsManager = await ensureUser('ops-manager@example.com', ['operations_manager'], 'Ops Manager');

// --- Catalogue --------------------------------------------------------------
// Kept at two store rooms, so AC5's "not scoped to equipment types or
// locations" covers where the equipment is kept as well as where the event is.
const ITEMS = [
  { name: 'Projector P-100', category: 'av', quantity: 10, current_location: 'Bugis Store Room' },
  { name: 'Wireless Mic WM-3', category: 'av', quantity: 4, current_location: 'Bugis Store Room' },
  { name: 'Lectern LC-1', category: 'furniture', quantity: 5, current_location: 'Marina Bay Store Room' },
];

const itemIds = {};
for (const item of ITEMS) {
  const { data, error } = await supabase.from('equipment').select('id').eq('name', item.name).maybeSingle();
  if (error) throw error;
  if (data) {
    itemIds[item.name] = data.id;
  } else {
    const inserted = await single(
      `insert ${item.name}`,
      supabase.from('equipment').insert({ ...item, created_by: techSupport }).select('id').single(),
    );
    itemIds[item.name] = inserted.id;
  }
}
const PROJECTOR = itemIds['Projector P-100'];
const MIC = itemIds['Wireless Mic WM-3'];
const LECTERN = itemIds['Lectern LC-1'];

async function venueId(name) {
  const venue = await single(`venue ${name}`, supabase.from('venues').select('id').eq('name', name).maybeSingle());
  return venue.id;
}

const eventName = (key, venue) => `${PREFIX} ${key} (${venue})`;

/**
 * One event in Planning with a confirmed booking at `venue`, and an equipment
 * request whose lines are added in the order given (the first is when it was
 * raised), with its status and unavailable lines set by hand.
 */
async function createEvent(spec) {
  const name = eventName(spec.key, spec.venue);
  check(`clear previous ${name}`, await supabase.from('event_request').delete().eq('name', name));

  const now = new Date().toISOString();
  const event = await single(
    `insert ${name}`,
    supabase
      .from('event_request')
      .insert({
        name,
        purpose: 'SCRUM-164 manual test',
        description: 'Seeded by scripts/seed-scrum164.mjs',
        organiser_id: organiser,
        status: 'planning',
        proposed_date: spec.date,
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

  // The event's venue, so "events at every location" (AC5) is true of the data
  // and not only of the event's name. Not read by the queue.
  const booking = await supabase.from('venue_booking').insert({
    venue_id: await venueId(spec.venue),
    event_request_id: event.id,
    date: spec.date,
    start_time: '10:00',
    end_time: '12:00',
  });
  if (booking.error) {
    console.warn(`  ! ${name}: no booking at ${spec.venue} on ${spec.date} (${booking.error.message}); the queue does not read it.`);
  }

  check(`request ${name}`, await supabase.from('equipment_request').insert({ event_request_id: event.id }));
  for (const line of spec.lines) {
    const saved = await single(
      `line ${name}`,
      supabase
        .from('equipment_request_line')
        .insert({
          event_request_id: event.id,
          equipment_id: line.equipmentId,
          quantity: line.quantity,
          created_by: coordinator,
          // Fixture data (SCRUM-166 sets this in the app).
          unavailable: line.unavailable ?? false,
        })
        .select('id')
        .single(),
    );
    if (line.reserved) {
      // DUMMY(SCRUM-167) D-18: reserved by hand.
      check(`reserve ${name}`, await supabase.from('equipment_reservation').insert({ line_id: saved.id }));
    }
  }
  // Fixture data (SCRUM-166 sets this in the app).
  check(
    `status ${name}`,
    await supabase.from('equipment_request').update({ status: spec.status }).eq('event_request_id', event.id),
  );
  console.log(`  ${event.reference}  ${spec.date}  ${spec.status.padEnd(20)} ${name}`);
}

/** EVT-C's line for `equipmentId`: reserved, and no longer unavailable. */
async function reserveEvtCLine(equipmentId) {
  const event = await single(
    'EVT-C',
    supabase.from('event_request').select('id').eq('name', eventName('EVT-C', 'Jurong East Training Room')).maybeSingle(),
  );
  const line = await single(
    'EVT-C line',
    supabase
      .from('equipment_request_line')
      .select('id')
      .eq('event_request_id', event.id)
      .eq('equipment_id', equipmentId)
      .maybeSingle(),
  );
  // DUMMY(SCRUM-167) D-18: reserved by hand.
  check('reserve', await supabase.from('equipment_reservation').upsert({ line_id: line.id }, { onConflict: 'line_id' }));
  // Fixture data (SCRUM-166 sets this in the app): no longer unavailable.
  check('unavailable', await supabase.from('equipment_request_line').update({ unavailable: false }).eq('id', line.id));
  return event.id;
}

// --- Steps ------------------------------------------------------------------
if (step === 'fixture') {
  // Start clean: every SCRUM-164 event, then Tampines Hall and its location.
  check('clear SCRUM-164 events', await supabase.from('event_request').delete().like('name', `${PREFIX} %`));
  check('clear Tampines Hall', await supabase.from('venues').delete().eq('name', 'Tampines Hall'));
  check('clear Tampines', await supabase.from('locations').delete().eq('name', 'Tampines'));

  console.log('Fixture F (raised in the order A, C, B, then D and E):');
  await createEvent({
    key: 'EVT-A', venue: 'Bugis Seminar Room', date: '2026-11-05', status: 'under_review',
    lines: [{ equipmentId: PROJECTOR, quantity: 2 }, { equipmentId: MIC, quantity: 4 }],
  });
  await createEvent({
    key: 'EVT-C', venue: 'Jurong East Training Room', date: '2026-11-12', status: 'partially_fulfilled',
    lines: [
      { equipmentId: PROJECTOR, quantity: 1, reserved: true },
      { equipmentId: MIC, quantity: 2, unavailable: true },
      { equipmentId: LECTERN, quantity: 1, unavailable: true },
    ],
  });
  await createEvent({
    key: 'EVT-B', venue: 'Marina Bay Ballroom', date: '2026-10-28', status: 'under_review',
    lines: [{ equipmentId: LECTERN, quantity: 1 }, { equipmentId: LECTERN, quantity: 2 }],
  });
  await createEvent({
    key: 'EVT-D', venue: 'Bugis Seminar Room', date: '2026-10-30', status: 'fulfilled',
    lines: [{ equipmentId: PROJECTOR, quantity: 3, reserved: true }],
  });
  await createEvent({
    key: 'EVT-E', venue: 'Marina Bay Ballroom', date: '2026-11-02', status: 'unable_to_fulfil',
    lines: [{ equipmentId: MIC, quantity: 1, unavailable: true }],
  });
}

if (step === 'reserve-mic') {
  // TC-164-12 step 2. EVT-C stays partially fulfilled, with the Lectern left.
  await reserveEvtCLine(MIC);
  console.log('EVT-C: Wireless Mic WM-3 reserved. 1 item (Lectern LC-1) still unavailable.');
}

if (step === 'reserve-lectern') {
  // TC-164-09 step 2. Nothing is left unavailable, so EVT-C is fulfilled.
  const eventId = await reserveEvtCLine(LECTERN);
  // Fixture data (SCRUM-166 sets this in the app).
  check(
    'status EVT-C',
    await supabase.from('equipment_request').update({ status: 'fulfilled' }).eq('event_request_id', eventId),
  );
  console.log('EVT-C: Lectern LC-1 reserved. Nothing unavailable; status fulfilled.');
}

if (step === 'add-year-end') {
  console.log('TC-164-05, across the year end:');
  await createEvent({
    key: 'EVT-G', venue: 'Bugis Seminar Room', date: '2027-01-03', status: 'under_review',
    lines: [{ equipmentId: PROJECTOR, quantity: 1 }],
  });
  await createEvent({
    key: 'EVT-H', venue: 'Marina Bay Ballroom', date: '2026-12-28', status: 'under_review',
    lines: [{ equipmentId: MIC, quantity: 1 }],
  });
}

if (step === 'add-tampines') {
  // TC-164-15: a location with no earlier requests, added today.
  const location = await single(
    'insert Tampines',
    supabase.from('locations').insert({ name: 'Tampines' }).select('id').single(),
  );
  check(
    'insert Tampines Hall',
    await supabase.from('venues').insert({
      name: 'Tampines Hall',
      location_id: location.id,
      max_capacity: 120,
      opens_at: '08:00',
      closes_at: '22:00',
    }),
  );
  console.log('Added location Tampines and venue Tampines Hall.');
  await createEvent({
    key: 'EVT-I', venue: 'Tampines Hall', date: '2026-11-18', status: 'under_review',
    // Kept at the Marina Bay Store Room: equipment from another location.
    lines: [{ equipmentId: LECTERN, quantity: 1 }],
  });
}

console.log(`\nAll passwords: ${TEST_PASSWORD}`);
console.log('Queue: http://localhost:3000/equipment-queue  (API: /api/equipment-queue)');
