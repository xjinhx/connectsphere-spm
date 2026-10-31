// Seeds the data for SCRUM-184's manual run (TC-184-01 to TC-184-09): one
// event per case the test case sheet names. Dates are set relative to today
// (D in the sheet), so the run works on any day. Run after `npm run db:reset`
// and `npm run seed:users`:
//
//   node scripts/seed-scrum184.mjs
//
// It prints each event's page address (/register-events/<id>) and Open
// events (/register-events), whose My registrations section (SCRUM-180) shows
// each registration's status. Safe to run again: it deletes and
// recreates only the events it made (matched by their description), which also
// clears their registrations.
//
// DUMMY(SCRUM-185) D-24: each event's registration capacity is set here, not
// by the coordinator's form (SCRUM-185 AC5, CL-59).
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

// Creates accounts with a known password through the service-role key, so it
// refuses to run against anything but the local stack (same guard as
// scripts/seed-scrum182.mjs).
if (!['127.0.0.1', 'localhost'].includes(new URL(supabaseUrl).hostname)) {
  throw new Error(`NEXT_PUBLIC_SUPABASE_URL (${supabaseUrl}) is not a local Supabase instance; refusing to run.`);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);
const TEST_PASSWORD = 'TestPass123!';
const SEEDED_BY = 'Seeded by scripts/seed-scrum184.mjs';
const NIGHT = 'Client Appreciation Night';

function check(label, { error }) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

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

// Accounts: attendee (Tan Mei Ling) is the one seed:users makes; attendee2 is
// the second attendee the sheet names. The fillers take the other places.
const attendee = await ensureUser('attendee@example.com', 'attendee', 'Tan Mei Ling');
const attendee2 = await ensureUser('attendee2@example.com', 'attendee', 'Lim Wei Jie');
const fillers = [];
for (let i = 1; i <= 19; i += 1) {
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

// [name, event date (days from D), registration period (days from D), fillers,
//  who else is registered, test cases]. Capacity 20 throughout.
const EVENTS = [
  [`${NIGHT} (withdraw)`, 16, [-3, 5], 19, ['attendee'], 'TC-184-01, then 03'],
  [`${NIGHT} (cancel withdraw)`, 16, [-3, 5], 19, ['attendee'], 'TC-184-02'],
  [`${NIGHT} (two attendees)`, 16, [-3, 5], 0, ['attendee', 'attendee2'], 'TC-184-04'],
  [`${NIGHT} (withdraw list)`, 16, [-3, 5], 0, ['attendee'], 'TC-184-05'],
  ['Partner Networking Lunch (withdraw list)', 21, [-3, 5], 0, ['attendee'], 'TC-184-05'],
  [`${NIGHT} (withdraw and return)`, 16, [-3, 5], 19, [], 'TC-184-06'],
  [`${NIGHT} (past)`, -10, [-20, -11], 0, ['attendee'], 'TC-184-07'],
  [`${NIGHT} (today)`, 0, [-10, -1], 0, ['attendee'], 'TC-184-08'],
  [`${NIGHT} (tomorrow)`, 1, [-10, 0], 19, ['attendee'], 'TC-184-09'],
];

const now = new Date().toISOString();
const rows = EVENTS.map(([name, eventDay, [start, end]]) => ({
  name,
  purpose: 'SCRUM-184 manual test',
  description: SEEDED_BY,
  status: 'confirmed',
  organiser_id: organiser,
  proposed_date: singaporeDate(eventDay),
  expected_attendance: 20,
  registration_required: true,
  registration_start_date: singaporeDate(start),
  registration_end_date: singaporeDate(end),
  registration_capacity: 20,
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

// Inserted directly, not through register_for_event, so the past and today
// events (whose registration period has closed) can hold a registration.
const PEOPLE = {
  attendee: { attendee_id: attendee, full_name: 'Tan Mei Ling', email: 'attendee@example.com', contact_number: '+65 9123 4567' },
  attendee2: { attendee_id: attendee2, full_name: 'Lim Wei Jie', email: 'attendee2@example.com', contact_number: '+65 9876 5432' },
};
const registrations = EVENTS.flatMap(([name, , , fillerCount, people]) => [
  ...people.map((who) => ({ event_request_id: idOf(name), ...PEOPLE[who] })),
  ...fillers.slice(0, fillerCount).map(({ id, n }) => ({
    event_request_id: idOf(name),
    attendee_id: id,
    full_name: `Filler Attendee ${n}`,
    email: `registration-filler-${n}@example.com`,
    contact_number: '+65 9000 0000',
  })),
]);
check('registrations', await supabase.from('event_registration').insert(registrations));

console.log(`Seeded ${created.length} events. Today (D) is ${ddmmyyyy(singaporeDate(0))}.`);
console.log(`Password for every account: ${TEST_PASSWORD}`);
console.log('My registrations (on Open events): http://localhost:3000/register-events#my-registrations\n');
for (const [name, eventDay, , fillerCount, people, cases] of EVENTS) {
  console.log(`${cases.padEnd(22)} ${name}`);
  console.log(
    `${''.padEnd(22)} held ${ddmmyyyy(singaporeDate(eventDay))}; ${fillerCount + people.length} of 20 places taken` +
      (people.length ? `; registered: ${people.map((who) => PEOPLE[who].email).join(', ')}` : ''),
  );
  console.log(`${''.padEnd(22)} http://localhost:3000/register-events/${idOf(name)}\n`);
}
