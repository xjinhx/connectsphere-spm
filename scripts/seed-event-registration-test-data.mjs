// Seeds the data for SCRUM-181's manual run (TC-181-01 to TC-181-18), one
// event per registration period the test case sheet names. Periods are set
// relative to today (D in the sheet), so the run works on any day. Run after
// `npm run db:reset` and `npm run seed:users`:
//
//   node scripts/seed-event-registration-test-data.mjs
//
// It prints each event's page address (/register-events/<id>): listing the
// events open for registration is another story's, so open them by address.
//
// DUMMY(SCRUM-185) D-22: the registration period is set here, not by the
// coordinator's form (SCRUM-185 AC5).
//
// Safe to run again: it deletes and recreates only the events it made (matched
// by their description), which also clears their registrations, so it doubles
// as "reset my test data".
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
const SEEDED_BY = 'Seeded by scripts/seed-event-registration-test-data.mjs';

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

// --- Accounts ---------------------------------------------------------------
// attendee@example.com is the account seed:users makes. attendee2 is the
// second attendee in TC-181-16. The 19 fillers take 19 of the 20 places in
// TC-181-02.
const attendee = await ensureUser('attendee@example.com', 'attendee', 'Tan Mei Ling');
await ensureUser('attendee2@example.com', 'attendee', 'Lim Wei Jie');
const fillers = [];
for (let i = 1; i <= 19; i += 1) {
  const n = String(i).padStart(2, '0');
  fillers.push(await ensureUser(`registration-filler-${n}@example.com`, 'attendee', `Filler Attendee ${n}`));
}
const organiser = await userIdByEmail('organiser@example.com');
const coordinator = await userIdByEmail('coordinator@example.com');
const opsManager = await userIdByEmail('ops-manager@example.com');
if (!organiser || !coordinator || !opsManager) {
  throw new Error('Run npm run seed:users first: organiser, coordinator or ops-manager is missing.');
}

// --- Events -----------------------------------------------------------------
check('clear old events', await supabase.from('event_request').delete().eq('description', SEEDED_BY));

const NIGHT = 'Client Appreciation Night';
// [name, period start, period end, test cases, extra columns]. Offsets are days from today (D).
const EVENTS = [
  [NIGHT, -3, 5, 'TC-181-01, 14, 16, 17, 18', { start_time: '11:00', end_time: '13:00', registration_capacity: 20 }],
  [`${NIGHT} (form checks)`, -3, 5, 'TC-181-03, 04', {}],
  [`${NIGHT} (last place)`, -3, 5, 'TC-181-02', { registration_capacity: 20 }],
  [`${NIGHT} (opens in 2 days)`, 2, 10, 'TC-181-05, 06', {}],
  [`${NIGHT} (opens tomorrow)`, 1, 10, 'TC-181-07', {}],
  [`${NIGHT} (closed 2 days ago)`, -10, -2, 'TC-181-08, 09', {}],
  [`${NIGHT} (closed yesterday)`, -10, -1, 'TC-181-10', {}],
  [`${NIGHT} (opens today)`, 0, 5, 'TC-181-11', {}],
  [`${NIGHT} (closes today)`, -5, 0, 'TC-181-12', {}],
  [`${NIGHT} (double submit)`, -3, 5, 'TC-181-15', {}],
  // TC-181-17, 18: already registered before the run. Product Launch Briefing
  // is on the same date as the Client Appreciation Night and overlaps it.
  ['Product Launch Briefing', -3, 5, 'TC-181-17, 18 (pre-registered)', { start_time: '10:00', end_time: '12:00' }],
  ['Partner Networking Lunch', -3, 5, 'TC-181-17 (pre-registered)', { proposed_date: singaporeDate(13) }],
];

const now = new Date().toISOString();
const rows = EVENTS.map(([name, start, end, , extra]) => ({
  name,
  purpose: 'SCRUM-181 manual test',
  description: SEEDED_BY,
  status: 'confirmed',
  organiser_id: organiser,
  proposed_date: singaporeDate(16),
  expected_attendance: 20,
  registration_required: true,
  registration_start_date: singaporeDate(start),
  registration_end_date: singaporeDate(end),
  submitted_at: now,
  decision: 'approved',
  decided_by: coordinator,
  decided_at: now,
  coordinator_id: coordinator,
  assigned_by: opsManager,
  assigned_at: now,
  ...extra,
}));

const { data: created, error: insertError } = await supabase.from('event_request').insert(rows).select('id, name');
if (insertError) throw new Error(`create events: ${insertError.message}`);
const idOf = (name) => created.find((event) => event.name === name).id;

// --- Registrations made before the run ---------------------------------------
const registration = (eventName, attendeeId, fullName, email) => ({
  event_request_id: idOf(eventName),
  attendee_id: attendeeId,
  full_name: fullName,
  email,
  contact_number: '+65 9000 0000',
});

check(
  'pre-registrations',
  await supabase.from('event_registration').insert([
    registration('Product Launch Briefing', attendee, 'Tan Mei Ling', 'attendee@example.com'),
    registration('Partner Networking Lunch', attendee, 'Tan Mei Ling', 'attendee@example.com'),
    ...fillers.map((id, i) =>
      registration(`${NIGHT} (last place)`, id, `Filler Attendee ${i + 1}`, `registration-filler-${i + 1}@example.com`),
    ),
  ]),
);

// --- Summary ----------------------------------------------------------------
console.log(`Seeded ${created.length} events. Today (D) is ${ddmmyyyy(singaporeDate(0))}.`);
console.log('Sign in as attendee@example.com (or attendee2@example.com for TC-181-16), password TestPass123!\n');
for (const [name, start, end, cases] of EVENTS) {
  console.log(`${cases.padEnd(32)} ${name}`);
  console.log(`${''.padEnd(32)} registration ${ddmmyyyy(singaporeDate(start))} to ${ddmmyyyy(singaporeDate(end))}`);
  console.log(`${''.padEnd(32)} http://localhost:3000/register-events/${idOf(name)}\n`);
}
