// Seeds the data for SCRUM-201's manual run (TC-201-01 to TC-201-09): one
// event per case in SCRUM-201-test-cases.xlsx, so the run needs no re-seeding
// part way. Dates are set relative to today (D in the sheet), so the run works
// on any day. Run after `npm run db:reset` and `npm run seed:users`:
//
//   node scripts/seed-scrum201.mjs
//
// It prints each event's page address (/register-events/<id>). Safe to run
// again: it deletes and recreates only the events it made (matched by their
// description), which also clears their registrations and notifications.
//
// Registrations are inserted directly, not through the app, so seeding sends
// no notifications: every notification seen in the run comes from the steps.
//
// DUMMY(SCRUM-184) D-28: the AC4 events (TC-201-07 to TC-201-09) need
// SCRUM-184's Withdraw action (PR #167), which is not on main yet. They are
// seeded now so the run is ready once it is.
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
const SEEDED_BY = 'Seeded by scripts/seed-scrum201.mjs';
const NIGHT = 'Client Appreciation Night';
const LUNCH = 'Partner Networking Lunch';
const BALLROOM = 'Marina Bay Ballroom';

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

// Registration periods, as days from today.
const OPEN = [-3, 5];
const CLOSED = [-10, -1];

// [name, event day, period, capacity, fillers registered, attendee@example.com registered, test cases].
const EVENTS = [
  [`${NIGHT} (confirm)`, 16, OPEN, 20, 5, false, 'TC-201-01'],
  [`${NIGHT} (already registered)`, 16, OPEN, 20, 0, true, 'TC-201-02'],
  [`${LUNCH} (closed)`, 10, CLOSED, 20, 0, false, 'TC-201-02'],
  [`${NIGHT} (incomplete)`, 16, OPEN, 20, 0, false, 'TC-201-02'],
  [`${NIGHT} (last place)`, 16, OPEN, 20, 19, false, 'TC-201-03'],
  [`${NIGHT} (full)`, 16, OPEN, 20, 20, false, 'TC-201-04, TC-201-05'],
  [`${LUNCH} (no capacity)`, 10, OPEN, null, 0, false, 'TC-201-04'],
  [`${LUNCH} (full and closed)`, 10, CLOSED, 20, 20, false, 'TC-201-05'],
  ['Product Launch Briefing (not open yet)', 20, [3, 9], 20, 0, false, 'TC-201-05'],
  [`${NIGHT} (last place race)`, 16, OPEN, 20, 19, false, 'TC-201-06'],
  [`${NIGHT} (withdraw)`, 16, OPEN, 20, 19, true, 'TC-201-07 (needs PR #167)'],
  [`${NIGHT} (cancel withdraw)`, 16, OPEN, 20, 0, true, 'TC-201-08 (needs PR #167)'],
  [`${NIGHT} (withdraw twice)`, 16, OPEN, 20, 0, true, 'TC-201-08 (needs PR #167)'],
  [`${NIGHT} (past)`, -10, [-20, -11], 20, 0, true, 'TC-201-08 (needs PR #167)'],
  [`${NIGHT} (tomorrow)`, 1, [-10, 0], 20, 0, true, 'TC-201-09 (needs PR #167)'],
  [`${NIGHT} (today)`, 0, CLOSED, 20, 0, true, 'TC-201-09 (needs PR #167)'],
];

// TC-201-01's confirmation names the venue: its event has a confirmed booking.
const BOOKED = `${NIGHT} (confirm)`;

async function seed() {
  // attendee (Tan Mei Ling) is the one seed:users makes; attendee2 is the
  // second attendee the sheet names. The 20 fillers take the places.
  const attendee = await ensureUser('attendee@example.com', 'attendee', 'Tan Mei Ling');
  await ensureUser('attendee2@example.com', 'attendee', 'Lim Wei Jie');
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

  const now = new Date().toISOString();
  const rows = EVENTS.map(([name, eventDay, [start, end], capacity]) => ({
    name,
    purpose: 'SCRUM-201 manual test',
    description: SEEDED_BY,
    status: 'confirmed',
    organiser_id: organiser,
    proposed_date: singaporeDate(eventDay),
    start_time: '19:00',
    end_time: '22:00',
    expected_attendance: 20,
    registration_required: true,
    registration_start_date: singaporeDate(start),
    registration_end_date: singaporeDate(end),
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

  const { data: venue, error: venueError } = await supabase.from('venues').select('id').eq('name', BALLROOM).maybeSingle();
  if (venueError) throw new Error(`venues: ${venueError.message}`);
  if (!venue) throw new Error(`Venue "${BALLROOM}" is missing: run npm run db:reset to load supabase/seed.sql.`);
  const booked = rows.find((row) => row.name === BOOKED);
  check(
    `booking (if it clashes, run npm run db:reset first)`,
    await supabase.from('venue_booking').insert({
      event_request_id: idOf(BOOKED),
      venue_id: venue.id,
      date: booked.proposed_date,
      start_time: booked.start_time,
      end_time: booked.end_time,
      status: 'confirmed',
    }),
  );

  const registrations = EVENTS.flatMap(([name, , , , fillerCount, withAttendee]) => [
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

  console.log(`Seeded ${created.length} events. Today (D) is ${ddmmyyyy(singaporeDate(0))}.`);
  console.log(`Password for every account: ${TEST_PASSWORD}\n`);
  for (const [name, eventDay, [start, end], capacity, fillerCount, withAttendee, cases] of EVENTS) {
    const taken = fillerCount + (withAttendee ? 1 : 0);
    const places = capacity === null ? 'no capacity set' : `${taken} of ${capacity} places taken`;
    console.log(`${cases.padEnd(28)} ${name}`);
    console.log(
      `${''.padEnd(28)} held ${ddmmyyyy(singaporeDate(eventDay))} 19:00-22:00${name === BOOKED ? ` at ${BALLROOM}` : ''}; ` +
        `registration ${ddmmyyyy(singaporeDate(start))} to ${ddmmyyyy(singaporeDate(end))}; ${places}` +
        `${withAttendee ? '; attendee@example.com Registered' : ''}`,
    );
    console.log(`${''.padEnd(28)} http://localhost:3000/register-events/${idOf(name)}\n`);
  }
}

await seed();
