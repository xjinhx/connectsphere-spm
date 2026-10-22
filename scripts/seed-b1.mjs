// Seeds the manual run of SCRUM-167 and SCRUM-173 (TC-167-01 to TC-167-10,
// TC-173-01 to TC-173-09) from the B1 test case sheet, "B1 Seed and Run
// Order". Needs 20261022004756_equipment_commitment_window and
// 20261022011508_reserve_equipment applied (`npm run db:reset` after pulling
// them) and `npm run seed:users`.
//
//   node scripts/seed-b1.mjs        Every SCRUM-167/173 event, item and hold (resets them all)
//
// Dates are the sheet's: F = 10/11/26, S4-E1's first booked day. Every event is
// Approved, assigned to coordinator@example.com (S4-PM: coordinator2@example.com),
// with confirmed venue bookings at a venue of its own, so no two events' bookings
// clash. Other events' holds are reserved through reserve_equipment, as
// Technical Support would in the app. Each case has its own item, so cases do
// not affect each other; run this again before re-running one that writes.
//
// SCRUM-175 and SCRUM-170's rows on the sheet are not seeded: those stories are
// not built yet.
//
// Safe to run again: every "B1 " event (its lines, reservations and bookings go
// with it), venue and EQ- item it made is deleted first.
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local before running this script.');
}
if (!['127.0.0.1', 'localhost'].includes(new URL(supabaseUrl).hostname)) {
  throw new Error("Refusing to run against anything but 127.0.0.1/localhost. Point .env.local at `npm run db:start`'s Supabase.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey);
const TEST_PASSWORD = 'TestPass123!';
const PREFIX = 'B1';
const LOCATION = 'B1 Test Location';

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
// TC-173-04: the afternoon event's coordinator.
const coordinator2 = await ensureUser('coordinator2@example.com', ['coordinator'], 'Coordinator B');
const techSupport = await ensureUser('tech-support@example.com', ['technical_support'], 'Tech Support');
const organiser = await ensureUser('organiser@example.com', ['event_organiser'], 'Organiser');
const opsManager = await ensureUser('ops-manager@example.com', ['operations_manager'], 'Ops Manager');

// --- Start clean ------------------------------------------------------------
check('clear B1 events', await supabase.from('event_request').delete().like('name', `${PREFIX} %`));
check('clear B1 venues', await supabase.from('venues').delete().like('name', `${PREFIX} %`));
check('clear B1 items', await supabase.from('equipment').delete().like('name', 'EQ-167-%'));
check('clear B1 items', await supabase.from('equipment').delete().like('name', 'EQ-173-%'));

const existingLocation = await supabase.from('locations').select('id').eq('name', LOCATION).maybeSingle();
check('location', existingLocation);
const locationId =
  existingLocation.data?.id ??
  (await single('insert location', supabase.from('locations').insert({ name: LOCATION }).select('id').single())).id;

// --- Catalogue (SCRUM-240) ---------------------------------------------------
const ITEMS = {
  'EQ-167-01': 10, 'EQ-167-02': 10, 'EQ-167-03': 10, 'EQ-167-04': 10, 'EQ-167-05': 10,
  'EQ-167-06': 10, 'EQ-167-07': 10, 'EQ-167-08': 10, 'EQ-167-09': 10, 'EQ-167-10': 10,
  'EQ-173-01': 10, 'EQ-173-02': 10, 'EQ-173-03': 10, 'EQ-173-04': 1, 'EQ-173-05': 10,
  'EQ-173-06A': 10, 'EQ-173-06B': 10, 'EQ-173-07A': 10, 'EQ-173-07B': 4, 'EQ-173-08': 10, 'EQ-173-09': 10,
};
const item = {};
for (const [name, quantity] of Object.entries(ITEMS)) {
  const saved = await single(
    `insert ${name}`,
    supabase
      .from('equipment')
      .insert({ name, category: 'av', quantity, current_location: 'Bugis Store Room', created_by: techSupport })
      .select('id')
      .single(),
  );
  item[name] = saved.id;
}

// --- Events -----------------------------------------------------------------
/** Every date from `from` to `to`, both included (YYYY-MM-DD). */
function dates(from, to = from) {
  const out = [];
  for (const day = new Date(`${from}T00:00:00Z`); day <= new Date(`${to}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + 1)) {
    out.push(day.toISOString().slice(0, 10));
  }
  return out;
}

const DAY = { start: '10:00', end: '18:00' };
const AM = { start: '08:00', end: '12:00' };
const PM = { start: '14:00', end: '18:00' };

/**
 * One Approved event. `booked`: its confirmed venue booking dates; `pending`:
 * dates of a venue booking request still Pending instead (TC-167-03); neither:
 * no venue booking request at all (TC-173-02).
 */
async function createEvent(key, { booked = [], pending = [], times = DAY, coordinatorId = coordinator }) {
  const name = `${PREFIX} ${key}`;
  const now = new Date().toISOString();
  const firstDate = booked[0] ?? pending[0] ?? null;
  const event = await single(
    `insert ${name}`,
    supabase
      .from('event_request')
      .insert({
        name,
        purpose: 'SCRUM-167/173 manual test',
        description: 'Seeded by scripts/seed-b1.mjs',
        organiser_id: organiser,
        status: 'approved',
        proposed_date: firstDate,
        start_time: times.start,
        end_time: times.end,
        expected_attendance: 50,
        submitted_at: now,
        decision: 'approved',
        decided_by: coordinatorId,
        decided_at: now,
        coordinator_id: coordinatorId,
        assigned_by: opsManager,
        assigned_at: now,
      })
      .select('id, reference')
      .single(),
  );

  if (booked.length > 0 || pending.length > 0) {
    const venue = await single(
      `venue ${name}`,
      supabase
        .from('venues')
        .insert({ name: `${PREFIX} Venue ${key}`, location_id: locationId, max_capacity: 100, opens_at: '07:00', closes_at: '23:00' })
        .select('id')
        .single(),
    );
    if (booked.length > 0) {
      check(
        `bookings ${name}`,
        await supabase
          .from('venue_booking')
          .insert(booked.map((date) => ({ venue_id: venue.id, event_request_id: event.id, date, start_time: times.start, end_time: times.end }))),
      );
    }
    if (pending.length > 0) {
      const request = await single(
        `booking request ${name}`,
        supabase
          .from('venue_booking_request')
          .insert({ event_request_id: event.id, venue_id: venue.id, requested_by: coordinatorId })
          .select('id')
          .single(),
      );
      check(
        `booking request lines ${name}`,
        await supabase
          .from('venue_booking_request_line')
          .insert(pending.map((date) => ({ request_id: request.id, date, start_time: times.start, end_time: times.end }))),
      );
    }
  }
  return { ...event, key, name };
}

/** Adds a line for `quantity` of the item to the event's equipment request, as its coordinator would. */
async function request(event, itemName, quantity, coordinatorId = coordinator) {
  check(
    `request ${event.name}`,
    await supabase.from('equipment_request').upsert({ event_request_id: event.id }, { onConflict: 'event_request_id' }),
  );
  const line = await single(
    `line ${event.name} ${itemName}`,
    supabase
      .from('equipment_request_line')
      .insert({ event_request_id: event.id, equipment_id: item[itemName], quantity, created_by: coordinatorId })
      .select('id')
      .single(),
  );
  return line.id;
}

/** Reserves `quantity` of the line through reserve_equipment, as Technical Support would in the app. */
async function reserve(event, lineId, quantity) {
  const { data, error } = await supabase.rpc('reserve_equipment', {
    p_line_id: lineId,
    p_quantity: quantity,
    p_reserved_by: techSupport,
  });
  if (error) throw new Error(`reserve for ${event.name}: ${error.message}`);
  if (data?.outcome !== 'reserved') throw new Error(`reserve for ${event.name}: ${JSON.stringify(data)}`);
}

/**
 * DUMMY(SCRUM-177) D-21: releases the line's reservation by hand. Releasing is
 * SCRUM-177's; TC-173-09 only needs a Released one to list.
 */
async function releaseByHand(event, lineId) {
  check(
    `release for ${event.name}`,
    await supabase.from('equipment_reservation').update({ status: 'released' }).eq('line_id', lineId),
  );
}

/** Another event holding `quantity` of the item: requested and reserved. */
async function hold(key, booked, itemName, quantity, times = DAY) {
  const event = await createEvent(key, { booked, times });
  await reserve(event, await request(event, itemName, quantity), quantity);
  return event;
}

const created = [];

// S4-E1: booked 10 to 12 Nov, window 9 to 12 Nov.
const e1 = await createEvent('S4-E1', { booked: dates('2026-11-10', '2026-11-12') });
created.push(e1);
await request(e1, 'EQ-167-01', 2); // TC-167-01
await request(e1, 'EQ-167-02', 8); // TC-167-02
await request(e1, 'EQ-167-04', 2); // TC-167-04
await request(e1, 'EQ-167-05', 6); // TC-167-05
await reserve(e1, await request(e1, 'EQ-167-06', 6), 4); // TC-167-06: 4 already reserved
await request(e1, 'EQ-167-07', 2); // TC-167-07
await request(e1, 'EQ-167-09', 2); // TC-167-09
await request(e1, 'EQ-167-10', 2); // TC-167-10
await request(e1, 'EQ-173-01', 4); // TC-173-01
await request(e1, 'EQ-173-03', 4); // TC-173-03
await reserve(e1, await request(e1, 'EQ-173-06A', 4), 4); // TC-173-06
await reserve(e1, await request(e1, 'EQ-173-06B', 2), 2); // TC-173-06
await reserve(e1, await request(e1, 'EQ-173-07A', 4), 4); // TC-173-07
await reserve(e1, await request(e1, 'EQ-173-07B', 6), 4); // TC-173-07: only 4 exist
const released = await request(e1, 'EQ-173-09', 3); // TC-173-09: reserved, then released
await reserve(e1, released, 3);
await releaseByHand(e1, released);

// TC-167-03, TC-173-08: venue booking request still Pending.
const pend = await createEvent('S4-PEND', { pending: dates('2026-11-10', '2026-11-12') });
await request(pend, 'EQ-167-03', 2);
await request(pend, 'EQ-173-08', 2);
created.push(pend);

// TC-173-02: no venue booking request at all.
const nb = await createEvent('S4-NB', {});
await request(nb, 'EQ-173-02', 2);
created.push(nb);

// TC-167-08, TC-173-04: same date, morning and afternoon.
const am = await createEvent('S4-AM', { booked: ['2026-11-20'], times: AM });
await reserve(am, await request(am, 'EQ-167-08', 4), 4);
await reserve(am, await request(am, 'EQ-173-04', 1), 1);
created.push(am);
const pm = await createEvent('S4-PM', { booked: ['2026-11-20'], times: PM, coordinatorId: coordinator2 });
await request(pm, 'EQ-167-08', 2, coordinator2); // TC-167-08. TC-173-04's line is added by coordinator2 in the run.
created.push(pm);

// TC-173-05: 30 days.
const long = await createEvent('S4-LONG', { booked: dates('2026-12-01', '2026-12-30') });
await request(long, 'EQ-173-05', 2);
created.push(long);

// TC-173-03: collecting on S4-E1's L (12 Nov) and on L+1 (13 Nov).
const l = await createEvent('H-173-03L', { booked: ['2026-11-13'] });
await request(l, 'EQ-173-03', 10);
created.push(l);
const n = await createEvent('H-173-03N', { booked: ['2026-11-14'] });
await request(n, 'EQ-173-03', 10);
created.push(n);

// Holds by other events.
created.push(await hold('H-167-01', dates('2026-11-14', '2026-11-15'), 'EQ-167-01', 4));
created.push(await hold('H-167-02', dates('2026-11-08', '2026-11-09'), 'EQ-167-02', 4));
created.push(await hold('H-167-05', dates('2026-11-10', '2026-11-11'), 'EQ-167-05', 6));
created.push(await hold('H-167-07', dates('2026-11-13', '2026-11-14'), 'EQ-167-07', 4));
created.push(await hold('H-167-09', dates('2026-11-07', '2026-11-08'), 'EQ-167-09', 4));
created.push(await hold('H-167-10A', dates('2026-11-08', '2026-11-09'), 'EQ-167-10', 4));
created.push(await hold('H-167-10B', dates('2026-11-13', '2026-11-14'), 'EQ-167-10', 4));

console.log('\nSCRUM-167/173 events (open each at the link, as tech-support@example.com unless the case says otherwise):');
for (const event of created) {
  console.log(`  ${event.reference}  ${event.key.padEnd(10)} http://localhost:3000/events/${event.id}/equipment`);
}
console.log('\nAccounts are the seed:users ones; coordinator2@example.com uses the same password.');
