// Seeds the data for SCRUM-182's manual run (TC-182-01 to TC-182-12): one
// event per fill level the test case sheet names. Periods are set relative to
// today (D in the sheet), so the run works on any day. Run after
// `npm run db:reset` and `npm run seed:users`:
//
//   node scripts/seed-scrum182.mjs
//
// It prints each event's page address (/register-events/<id>). Safe to run
// again: it deletes and recreates only the events it made (matched by their
// description), which also clears their registrations.
//
// Each event's registration capacity is set here as test data. In the app the
// assigned coordinator sets it on the event's registration page (SCRUM-185
// AC5, CL-59), which replaced dummy D-24.
//
// DUMMY(SCRUM-184) D-25: withdrawing is done by these flags, not by the
// attendee (SCRUM-184). Each sets one Registered registration to Withdrawn on
// an already-seeded event, without re-seeding:
//
//   --withdraw           Filler Attendee 1 on (withdrawal)           TC-182-09
//   --withdraw-over      the next filler on (over capacity)          TC-182-10
//   --withdraw-attendee  attendee@example.com on (withdraw and return) TC-182-11
//   --withdraw-waiting   Filler Attendee 1 on (no waiting list)       TC-182-12
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
const SEEDED_BY = 'Seeded by scripts/seed-scrum182.mjs';
const NIGHT = 'Client Appreciation Night';

function check(label, { error }) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

// --- Withdrawing (D-25) -------------------------------------------------------
const WITHDRAWALS = {
  '--withdraw': [`${NIGHT} (withdrawal)`, 'filler'],
  '--withdraw-over': [`${NIGHT} (over capacity)`, 'filler'],
  '--withdraw-attendee': [`${NIGHT} (withdraw and return)`, 'attendee@example.com'],
  '--withdraw-waiting': [`${NIGHT} (no waiting list)`, 'filler'],
};

async function withdrawOne(flag) {
  if (!WITHDRAWALS[flag]) throw new Error(`Unknown flag ${flag}. Use one of: ${Object.keys(WITHDRAWALS).join(', ')}`);
  const [eventName, who] = WITHDRAWALS[flag];

  const { data: event, error: eventError } = await supabase
    .from('event_request')
    .select('id, registration_capacity')
    .eq('description', SEEDED_BY)
    .eq('name', eventName)
    .maybeSingle();
  if (eventError) throw new Error(`find ${eventName}: ${eventError.message}`);
  if (!event) throw new Error(`${eventName} is not seeded. Run node scripts/seed-scrum182.mjs first.`);

  // 'filler' takes the first filler still Registered, so --withdraw-over can run twice.
  let query = supabase
    .from('event_registration')
    .select('id, full_name, email')
    .eq('event_request_id', event.id)
    .eq('status', 'registered')
    .order('email')
    .limit(1);
  query = who === 'filler' ? query.like('email', 'registration-filler-%') : query.eq('email', who);
  const { data: rows, error: findError } = await query;
  if (findError) throw new Error(`find registration: ${findError.message}`);
  if (!rows.length) throw new Error(`No Registered registration left to withdraw on ${eventName}.`);

  check('withdraw', await supabase.from('event_registration').update({ status: 'withdrawn' }).eq('id', rows[0].id));

  const { count } = await supabase
    .from('event_registration')
    .select('id', { count: 'exact', head: true })
    .eq('event_request_id', event.id)
    .eq('status', 'registered');
  console.log(`Withdrew ${rows[0].full_name} (${rows[0].email}) on ${eventName}.`);
  console.log(`Now ${count} of ${event.registration_capacity} places taken. Reload the event page.`);
}

// --- Seeding ------------------------------------------------------------------
async function userIdByEmail(email) {
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((user) => user.email === email)?.id;
}

async function ensureUser(email, role, fullName) {
  const { error } = await supabase.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });
  if (error && !error.message.toLowerCase().includes('already been registered')) {
    throw new Error(`create ${email}: ${error.message}`);
  }
  const id = await userIdByEmail(email);
  if (!id) throw new Error(`${email} not found after creating it. Did you run npm run seed:users?`);
  check(`profile ${email}`, await supabase.from('profiles').update({ roles: [role], full_name: fullName }).eq('id', id));
  return id;
}

// Dates are Singapore dates, because the app shows and compares them that way.
function singaporeDate(daysFromToday) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

const ddmmyyyy = (iso) => iso.split('-').reverse().join('/');

async function seed() {
  // Accounts: attendee (Tan Mei Ling) is the one seed:users makes; attendee2 and
  // attendee3 are the second and third attendees the sheet names. The 20 fillers
  // take the places.
  const attendee = await ensureUser('attendee@example.com', 'attendee', 'Tan Mei Ling');
  await ensureUser('attendee2@example.com', 'attendee', 'Lim Wei Jie');
  await ensureUser('attendee3@example.com', 'attendee', 'Siti Nur Aisyah');
  const fillers = [];
  for (let i = 1; i <= 20; i += 1) {
    const n = String(i).padStart(2, '0');
    fillers.push({ id: await ensureUser(`registration-filler-${n}@example.com`, 'attendee', `Filler Attendee ${n}`), n });
  }
  const organiser = await userIdByEmail('organiser@example.com');
  const coordinator = await userIdByEmail('coordinator@example.com');
  const opsManager = await userIdByEmail('ops-manager@example.com');
  if (!organiser || !coordinator || !opsManager) {
    throw new Error('Run npm run seed:users first: organiser, coordinator or ops-manager is missing.');
  }

  check('clear old events', await supabase.from('event_request').delete().eq('description', SEEDED_BY));

  // [name, capacity, fillers registered, attendee@example.com registered, test cases].
  // Every period is D-3 to D+5, so all are open today. Each case that takes a
  // place has its own event, so the run needs no re-seeding part way.
  const EVENTS = [
    [`${NIGHT} (full)`, 20, 20, false, 'TC-182-01'],
    [`${NIGHT} (no capacity)`, null, 0, false, 'TC-182-02'],
    [`${NIGHT} (last place)`, 20, 19, false, 'TC-182-03'],
    ['Partner Networking Lunch (full)', 20, 20, false, 'TC-182-04'],
    [`${NIGHT} (beside a full event)`, 20, 19, false, 'TC-182-04'],
    [`${NIGHT} (race)`, 20, 19, false, 'TC-182-05, then 08'],
    [`${NIGHT} (two places)`, 20, 18, false, 'TC-182-07'],
    [`${NIGHT} (withdrawal)`, 20, 20, false, 'TC-182-09 (then --withdraw)'],
    [`${NIGHT} (over capacity)`, 2, 3, false, 'TC-182-10 (then --withdraw-over, twice)'],
    [`${NIGHT} (withdraw and return)`, 20, 19, true, 'TC-182-11 (then --withdraw-attendee)'],
    [`${NIGHT} (no waiting list)`, 20, 20, false, 'TC-182-12 (then --withdraw-waiting)'],
  ];

  const now = new Date().toISOString();
  const rows = EVENTS.map(([name, capacity]) => ({
    name,
    purpose: 'SCRUM-182 manual test',
    description: SEEDED_BY,
    status: 'confirmed',
    organiser_id: organiser,
    proposed_date: singaporeDate(16),
    expected_attendance: 20,
    registration_required: true,
    registration_start_date: singaporeDate(-3),
    registration_end_date: singaporeDate(5),
    registration_capacity: capacity,
    submitted_at: now,
    decision: 'approved',
    decided_by: coordinator,
    decided_at: now,
    coordinator_id: coordinator,
    assigned_by: opsManager,
    assigned_at: now,
  }));

  const { data: created, error: insertError } = await supabase.from('event_request').insert(rows).select('id, name');
  if (insertError) throw new Error(`create events: ${insertError.message}`);
  const idOf = (name) => created.find((event) => event.name === name).id;

  // Inserted directly, not through register_for_event, so (over capacity) can
  // hold 3 registrations against a capacity of 2, as if the capacity had been
  // lowered after they registered (TC-182-10).
  const registrations = EVENTS.flatMap(([name, , fillerCount, withAttendee]) => [
    ...(withAttendee
      ? [{ event_request_id: idOf(name), attendee_id: attendee, full_name: 'Tan Mei Ling', email: 'attendee@example.com' }]
      : []),
    ...fillers.slice(0, fillerCount).map(({ id, n }) => ({
      event_request_id: idOf(name),
      attendee_id: id,
      full_name: `Filler Attendee ${n}`,
      email: `registration-filler-${n}@example.com`,
    })),
  ]).map((row) => ({ ...row, contact_number: '+65 9000 0000' }));
  check('registrations', await supabase.from('event_registration').insert(registrations));

  console.log(`Seeded ${created.length} events, registration ${ddmmyyyy(singaporeDate(-3))} to ${ddmmyyyy(singaporeDate(5))}.`);
  console.log(`Today (D) is ${ddmmyyyy(singaporeDate(0))}. Password for every account: ${TEST_PASSWORD}\n`);
  for (const [name, capacity, fillerCount, withAttendee, cases] of EVENTS) {
    const taken = fillerCount + (withAttendee ? 1 : 0);
    console.log(`${cases.padEnd(40)} ${name}`);
    console.log(`${''.padEnd(40)} ${capacity === null ? 'no capacity set' : `${taken} of ${capacity} places taken`}`);
    console.log(`${''.padEnd(40)} http://localhost:3000/register-events/${idOf(name)}\n`);
  }
}

const flag = process.argv.slice(2).find((arg) => arg.startsWith('--'));
await (flag ? withdrawOne(flag) : seed());
