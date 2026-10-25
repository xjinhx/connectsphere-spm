// Seeds the manual run of basket B3 from Marcus's Sprint 4 test case sheets.
// So far SCRUM-102 (TC-102-01 to TC-102-17) and SCRUM-104 (TC-104-01 to
// TC-104-14); SCRUM-105, 177 and 256 add their events here as they are built.
// Needs 20261025084357_event_completion applied (`npm run db:reset` after
// pulling it) and `npm run seed:users`.
//
//   node scripts/seed-b3.mjs                    Every B3 event and item (resets them all)
//   node scripts/seed-b3.mjs completion-check   SCRUM-104: run the completion check once, as pg_cron does daily
//
// Each case has its own event, named as on the sheet (E102-A ...), at the
// seeded Marina Bay Ballroom, Bugis Seminar Room and Jurong East Training Room.
// SCRUM-102's are on dates from 10/11/2026, in the morning; SCRUM-104's are on
// dates relative to the day the seed is run, in the afternoon, so no two
// events' bookings meet. Every event is
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

// SCRUM-104 AC2, AC3: the function pg_cron runs daily at 00:05 Singapore time.
if (process.argv[2] === 'completion-check') {
  const { data, error } = await supabase.rpc('complete_past_events');
  if (error) throw new Error(`completion check: ${error.message}`);
  console.log(`Completion check run: ${data} event(s) completed.`);
  process.exit(0);
}
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
check('clear B3 items', await supabase.from('equipment').delete().like('name', 'EQ-102-%'));
check('clear B3 unavailable periods', await supabase.from('venue_unavailable_slot').delete().eq('reason', UNAVAILABLE_REASON));

// --- Venues (supabase/seed.sql) ---------------------------------------------
const venue = {};
for (const name of ['Marina Bay Ballroom', 'Bugis Seminar Room', 'Jurong East Training Room']) {
  venue[name] = (await single(`venue ${name}`, supabase.from('venues').select('id').eq('name', name).single())).id;
}

// --- Catalogue (SCRUM-240) ---------------------------------------------------
const item = {};
for (const [name, quantity] of Object.entries({ 'EQ-102-01': 4, 'EQ-102-02': 2 })) {
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
 * essential (SCRUM-100); the rest are not required. A Draft is neither
 * submitted, decided nor assigned; a Submitted one is not decided yet; a
 * Rejected one carries its reason, as the event_request constraints require.
 * `extra` is written as it is (SCRUM-104's completed_at and completed_by).
 */
async function createEvent(key, { status = 'planning', essential = [], date = '2026-11-10', extra = {} } = {}) {
  const name = `${PREFIX} ${key}`;
  const now = new Date().toISOString();
  const draft = status === 'draft';
  const decided = !draft && status !== 'submitted';
  const event = await single(
    `insert ${name}`,
    supabase
      .from('event_request')
      .insert({
        name,
        purpose: `SCRUM-${key.slice(1, 4)} manual test`,
        description: 'Seeded by scripts/seed-b3.mjs',
        organiser_id: organiser,
        status,
        proposed_date: date,
        start_time: MORNING.start,
        end_time: MORNING.end,
        expected_attendance: 50,
        submitted_at: draft ? null : now,
        decision: decided ? (status === 'rejected' ? 'rejected' : 'approved') : null,
        rejection_reason: status === 'rejected' ? 'Date clashes with a client blackout (B3 seed)' : null,
        decided_by: decided ? coordinator : null,
        decided_at: decided ? now : null,
        coordinator_id: draft ? null : coordinator,
        assigned_by: draft ? null : opsManager,
        assigned_at: draft ? null : now,
        ...extra,
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

// --- SCRUM-104 ---------------------------------------------------------------
// Dates relative to today in Singapore, the day the completion check and
// "has its end date passed" are judged against.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());
function day(offset) {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
const LATE = { start: '16:30', end: '18:00' };
const created104 = [];

// TC-104-01: Preparation, booking ended yesterday.
const a104 = await createEvent('E104-A', { status: 'preparation', date: day(-1) });
await book(a104, 'Marina Bay Ballroom', day(-1), AFTERNOON);
created104.push(a104);

// TC-104-03: Preparation, booking ends today.
const b104 = await createEvent('E104-B', { status: 'preparation', date: day(0) });
await book(b104, 'Marina Bay Ballroom', day(0), AFTERNOON);
created104.push(b104);

// TC-104-04: Preparation, booking in 10 days.
const c104 = await createEvent('E104-C', { status: 'preparation', date: day(10) });
await book(c104, 'Marina Bay Ballroom', day(10), AFTERNOON);
created104.push(c104);

// TC-104-05: Preparation, bookings 3 days ago and tomorrow.
const d104 = await createEvent('E104-D', { status: 'preparation', date: day(-3) });
await book(d104, 'Marina Bay Ballroom', day(-3), AFTERNOON);
await book(d104, 'Marina Bay Ballroom', day(1), AFTERNOON);
created104.push(d104);

// TC-104-02: Preparation, no booking, proposed date yesterday.
created104.push(await createEvent('E104-E', { status: 'preparation', date: day(-1) }));

// TC-104-06: Confirmed, awaiting its safety check, booking ended yesterday.
const f104 = await createEvent('E104-F', { status: 'confirmed', date: day(-1) });
await book(f104, 'Bugis Seminar Room', day(-1), AFTERNOON);
created104.push(f104);

// TC-104-07: back in Planning after a Rejected safety check, booking ended yesterday.
const safetyOfficer = await ensureUser('safety-officer@example.com', ['safety_officer'], 'Safety Officer');
const g104 = await createEvent('E104-G', { date: day(-1) });
await book(g104, 'Bugis Seminar Room', day(-1), LATE);
check(
  'safety check E104-G',
  await supabase.from('safety_check').insert({
    event_request_id: g104.id,
    decision: 'rejected',
    note: 'No crowd control plan for the ballroom exits (B3 seed)',
    decided_by: safetyOfficer,
  }),
);
created104.push(g104);

// TC-104-08: Approved, proposed date yesterday.
created104.push(await createEvent('E104-H', { status: 'approved', date: day(-1) }));

// TC-104-09: Preparation, booking ended yesterday, for coordinator2 and the Lead to try.
const i104 = await createEvent('E104-I', { status: 'preparation', date: day(-1) });
await book(i104, 'Marina Bay Ballroom', day(-1), LATE);
created104.push(i104);

// TC-104-10, TC-104-13: one event in each of these statuses, ended 7 days ago (proposed date, no booking).
for (const [key, status] of [
  ['E104-S1', 'submitted'],
  ['E104-S2', 'approved'],
  ['E104-S3', 'planning'],
  ['E104-S4', 'confirmed'],
  ['E104-S5', 'preparation'],
  ['E104-X1', 'cancelled'],
  ['E104-X2', 'draft'],
  ['E104-X3', 'rejected'],
]) {
  created104.push(await createEvent(key, { status, date: day(-7) }));
}

// TC-104-12: Preparation, ended 6 days ago. TC-104-11: 8 days ago.
created104.push(await createEvent('E104-S6', { status: 'preparation', date: day(-6) }));
created104.push(await createEvent('E104-S8', { status: 'preparation', date: day(-8) }));

// TC-104-14: completed by the coordinator 9 days ago, ended 10 days ago.
const nineDaysAgo = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString();
created104.push(
  await createEvent('E104-S9', {
    status: 'completed',
    date: day(-10),
    extra: { completed_at: nineDaysAgo, completed_by: coordinator },
  }),
);

console.log('\nSCRUM-102 events (open each at the link, as coordinator@example.com unless the case says otherwise):');
for (const event of created) {
  console.log(`  ${event.reference}  ${event.key.padEnd(7)} http://localhost:3000/events/${event.id}/review`);
}
console.log('\nSCRUM-104 events (E104-X2 is a Draft: organiser@example.com sees it under My event requests):');
for (const event of created104) {
  console.log(`  ${event.reference}  ${event.key.padEnd(7)} http://localhost:3000/events/${event.id}/review`);
}
console.log('\nAccounts are the seed:users ones; coordinator2@example.com and venue-staff@example.com use the same password.');
