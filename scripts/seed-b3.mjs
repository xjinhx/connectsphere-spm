// Seeds the manual run of basket B3 from Marcus's Sprint 4 test case sheets.
// So far SCRUM-102 (TC-102-01 to TC-102-17); SCRUM-104, 105, 177 and 256 add
// their events here as they are built. Needs
// 20261023121849_event_confirmed_notification applied (`npm run db:reset` after
// pulling it) and `npm run seed:users`.
//
//   node scripts/seed-b3.mjs        Every B3 event and item (resets them all)
//
// Each case has its own event, named as on the sheet (E102-A ...), at the
// seeded Marina Bay Ballroom, Bugis Seminar Room and Jurong East Training Room,
// on dates from 10/11/2026 that no two events' bookings share. Every event is
// assigned to coordinator@example.com with organiser@example.com as its
// organiser, and is in Planning unless the case says otherwise. Bookings,
// lines and unavailable periods are written as the app stores them;
// reservations go through reserve_equipment, as Technical Support would.
// Run this again before re-running a case that confirms.
//
// Safe to run again: every "B3 " event (its lines, bookings, reservations,
// essential set and notifications go with it), EQ-102- item and B3 unavailable
// period is deleted first.
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
const PREFIX = 'B3';
const UNAVAILABLE_REASON = 'Ceiling repair (B3 seed)';

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
// TC-102-17: a coordinator the event is not assigned to, and the Lead.
await ensureUser('coordinator2@example.com', ['coordinator'], 'Coordinator B');
const opsManager = await ensureUser('ops-manager@example.com', ['operations_manager'], 'Ops Manager');
const organiser = await ensureUser('organiser@example.com', ['event_organiser'], 'Organiser');
const techSupport = await ensureUser('tech-support@example.com', ['technical_support'], 'Tech Support');
// TC-102-12: the Pending line is still in the Venue Staff queue.
const venueStaff = await ensureUser('venue-staff@example.com', ['venue_staff'], 'Venue Staff');

// --- Start clean ------------------------------------------------------------
check('clear B3 events', await supabase.from('event_request').delete().like('name', `${PREFIX} %`));
check('clear B3 items', await supabase.from('equipment').delete().or('name.like.EQ-102-%,name.like.EQ-177-%'));
check('clear B3 unavailable periods', await supabase.from('venue_unavailable_slot').delete().eq('reason', UNAVAILABLE_REASON));

// --- Venues (supabase/seed.sql) ---------------------------------------------
const venue = {};
for (const name of ['Marina Bay Ballroom', 'Bugis Seminar Room', 'Jurong East Training Room']) {
  venue[name] = (await single(`venue ${name}`, supabase.from('venues').select('id').eq('name', name).single())).id;
}

// --- Catalogue (SCRUM-240) ---------------------------------------------------
const item = {};
for (const [name, quantity] of Object.entries({ 'EQ-102-01': 4, 'EQ-102-02': 2, 'EQ-177-01': 5, 'EQ-177-02': 3 })) {
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
const MORNING = { start: '10:00', end: '12:00' };
const AFTERNOON = { start: '14:00', end: '16:00' };

/**
 * One event, assigned and approved, then moved to `status` (Planning unless
 * the case says otherwise). `essential` lists the arrangements marked
 * essential (SCRUM-100); the rest are not required.
 */
async function createEvent(key, { status = 'planning', essential = [], date = '2026-11-10' } = {}) {
  const name = `${PREFIX} ${key}`;
  const now = new Date().toISOString();
  const event = await single(
    `insert ${name}`,
    supabase
      .from('event_request')
      .insert({
        name,
        purpose: 'SCRUM-102 manual test',
        description: 'Seeded by scripts/seed-b3.mjs',
        organiser_id: organiser,
        status,
        proposed_date: date,
        start_time: MORNING.start,
        end_time: MORNING.end,
        expected_attendance: 50,
        submitted_at: now,
        decision: 'approved',
        decided_by: coordinator,
        decided_at: now,
        coordinator_id: coordinator,
        assigned_by: opsManager,
        assigned_at: now,
      })
      .select('id, reference')
      .single(),
  );
  check(
    `essential set ${name}`,
    await supabase.from('event_essential_arrangements').insert({
      event_request_id: event.id,
      venue: essential.includes('venue'),
      equipment: essential.includes('equipment'),
      technical_support: false,
      registration: false,
      recorded_by: coordinator,
    }),
  );
  return { ...event, key, name };
}

/** A confirmed booking, as Venue Staff approving its line leaves it. */
async function book(event, venueName, date, times = MORNING) {
  check(
    `booking ${event.name}`,
    await supabase
      .from('venue_booking')
      .insert({ venue_id: venue[venueName], event_request_id: event.id, date, start_time: times.start, end_time: times.end }),
  );
}

/** A booking the coordinator has released, with a reason (SCRUM-231). */
async function released(event, venueName, date, times = MORNING) {
  check(
    `released booking ${event.name}`,
    await supabase.from('venue_booking').insert({
      venue_id: venue[venueName],
      event_request_id: event.id,
      date,
      start_time: times.start,
      end_time: times.end,
      status: 'released',
      release_reason: 'Client needs one room only',
      released_by: coordinator,
      released_at: new Date().toISOString(),
    }),
  );
}

/** A booking request with one line, Pending unless `rejected` (SCRUM-149, with its reason). */
async function requestLine(event, venueName, date, times = MORNING, { rejected = false } = {}) {
  const request = await single(
    `booking request ${event.name}`,
    supabase
      .from('venue_booking_request')
      .insert({ event_request_id: event.id, venue_id: venue[venueName], requested_by: coordinator })
      .select('id')
      .single(),
  );
  check(
    `booking request line ${event.name}`,
    await supabase.from('venue_booking_request_line').insert({
      request_id: request.id,
      date,
      start_time: times.start,
      end_time: times.end,
      ...(rejected
        ? {
            status: 'rejected',
            decided_by: venueStaff,
            decided_at: new Date().toISOString(),
            rejection_reason: 'Ballroom closed for a private function',
          }
        : {}),
    }),
  );
}

/** Venue Staff mark 10:00 to 11:00 unavailable, which leaves a booking over it affected (SCRUM-151). */
async function unavailable(venueName, date) {
  check(
    `unavailable ${venueName} ${date}`,
    await supabase.from('venue_unavailable_slot').insert({
      venue_id: venue[venueName],
      date,
      start_time: '10:00',
      end_time: '11:00',
      reason: UNAVAILABLE_REASON,
      recorded_by: venueStaff,
    }),
  );
}

/** A line for `quantity` of the item, as the coordinator records it; `reserve` of it reserved through reserve_equipment. */
async function equipment(event, itemName, quantity, reserve = 0) {
  check(
    `request ${event.name}`,
    await supabase.from('equipment_request').upsert({ event_request_id: event.id }, { onConflict: 'event_request_id' }),
  );
  const line = await single(
    `line ${event.name} ${itemName}`,
    supabase
      .from('equipment_request_line')
      .insert({ event_request_id: event.id, equipment_id: item[itemName], quantity, created_by: coordinator })
      .select('id')
      .single(),
  );
  if (reserve === 0) return;
  const { data, error } = await supabase.rpc('reserve_equipment', {
    p_line_id: line.id,
    p_quantity: reserve,
    p_reserved_by: techSupport,
  });
  if (error) throw new Error(`reserve for ${event.name}: ${error.message}`);
  if (data?.outcome !== 'reserved') throw new Error(`reserve for ${event.name}: ${JSON.stringify(data)}`);
}

const created = [];

// TC-102-01: a Pending line.
const a = await createEvent('E102-A', { essential: ['venue'] });
await requestLine(a, 'Marina Bay Ballroom', '2026-11-10');
created.push(a);

// TC-102-02: one booking approved, another line still Pending.
const b = await createEvent('E102-B', { essential: ['venue'] });
await book(b, 'Bugis Seminar Room', '2026-11-10');
await requestLine(b, 'Jurong East Training Room', '2026-11-11', AFTERNOON);
created.push(b);

// TC-102-03: its only line Rejected.
const c = await createEvent('E102-C', { essential: ['venue'] });
await requestLine(c, 'Marina Bay Ballroom', '2026-11-10', MORNING, { rejected: true });
created.push(c);

// TC-102-04: its only booking affected.
const d = await createEvent('E102-D', { essential: ['venue'], date: '2026-11-12' });
await book(d, 'Bugis Seminar Room', '2026-11-12');
await unavailable('Bugis Seminar Room', '2026-11-12');
created.push(d);

// TC-102-05: EQ-102-01 2 of 4 reserved; EQ-102-02 2 of 2.
const e = await createEvent('E102-E', { essential: ['equipment'], date: '2026-11-13' });
await book(e, 'Marina Bay Ballroom', '2026-11-13');
await equipment(e, 'EQ-102-01', 4, 2);
await equipment(e, 'EQ-102-02', 2, 2);
created.push(e);

// TC-102-06: equipment essential, nothing requested.
const f = await createEvent('E102-F', { essential: ['equipment'], date: '2026-11-13' });
await book(f, 'Jurong East Training Room', '2026-11-13');
created.push(f);

// TC-102-07: venue and equipment both outstanding.
const g = await createEvent('E102-G', { essential: ['venue', 'equipment'], date: '2026-11-14' });
await requestLine(g, 'Marina Bay Ballroom', '2026-11-14');
await equipment(g, 'EQ-102-01', 2);
created.push(g);

// TC-102-08, TC-102-14: two approved bookings; confirmed in TC-102-08.
const h = await createEvent('E102-H', { essential: ['venue'], date: '2026-11-15' });
await book(h, 'Marina Bay Ballroom', '2026-11-15');
await book(h, 'Bugis Seminar Room', '2026-11-16');
created.push(h);

// TC-102-09: one booking approved, one released.
const i = await createEvent('E102-I', { essential: ['venue'], date: '2026-11-17' });
await book(i, 'Bugis Seminar Room', '2026-11-17');
await released(i, 'Marina Bay Ballroom', '2026-11-17');
created.push(i);

// TC-102-10: EQ-102-02 2 of 2 reserved.
const j = await createEvent('E102-J', { essential: ['equipment'], date: '2026-11-17' });
await book(j, 'Jurong East Training Room', '2026-11-17');
await equipment(j, 'EQ-102-02', 2, 2);
created.push(j);

// TC-102-11: nothing essential.
const k = await createEvent('E102-K', { date: '2026-11-18' });
await book(k, 'Marina Bay Ballroom', '2026-11-18');
created.push(k);

// TC-102-12: nothing essential; a Pending line and EQ-102-01 0 of 2.
const l = await createEvent('E102-L', { date: '2026-11-18' });
await requestLine(l, 'Jurong East Training Room', '2026-11-18', AFTERNOON);
await equipment(l, 'EQ-102-01', 2);
created.push(l);

// TC-102-13: venue not essential; its booking affected.
const m = await createEvent('E102-M', { date: '2026-11-19' });
await book(m, 'Bugis Seminar Room', '2026-11-19');
await unavailable('Bugis Seminar Room', '2026-11-19');
created.push(m);

// TC-102-16: Approved, no booking request.
created.push(await createEvent('E102-N', { status: 'approved', date: '2026-11-20' }));

// TC-102-17: Planning, nothing essential.
created.push(await createEvent('E102-O', { date: '2026-11-20' }));

console.log('\nSCRUM-102 events (open each at the link, as coordinator@example.com unless the case says otherwise):');
for (const event of created) {
  console.log(`  ${event.reference}  ${event.key.padEnd(7)} http://localhost:3000/events/${event.id}/review`);
}

// --- SCRUM-177 ---------------------------------------------------------------
// Both booked 10/11/2026 in the afternoon, so their window is 09/11/2026 to
// 10/11/2026 and no SCRUM-102 booking meets theirs.
const created177 = [];

// TC-177-01 to TC-177-09, TC-177-11: 4 of EQ-177-01 and 2 of EQ-177-02, both Reserved.
const a177 = await createEvent('E177-A');
await book(a177, 'Jurong East Training Room', '2026-11-10', AFTERNOON);
await equipment(a177, 'EQ-177-01', 4, 4);
await equipment(a177, 'EQ-177-02', 2, 2);
created177.push(a177);

// TC-177-02: the same window, 3 of EQ-177-01 requested and nothing reserved.
const b177 = await createEvent('E177-B');
await book(b177, 'Bugis Seminar Room', '2026-11-10', AFTERNOON);
await equipment(b177, 'EQ-177-01', 3);
created177.push(b177);

console.log('\nSCRUM-177 events (equipment pages; as tech-support@example.com unless the case says otherwise):');
for (const event of created177) {
  console.log(`  ${event.reference}  ${event.key.padEnd(7)} http://localhost:3000/events/${event.id}/equipment`);
}
console.log('\nAccounts are the seed:users ones; coordinator2@example.com and venue-staff@example.com use the same password.');
