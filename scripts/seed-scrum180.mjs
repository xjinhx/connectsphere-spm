// Seeds SCRUM-180's manual run (TC-180-01 to TC-180-15): Browse open events
// and see my registrations. Dates are relative to today (D in the sheet), so
// the run works on any day.
//
// Run: npm run db:start && npm run db:reset && npm run seed:users
//      node scripts/seed-scrum180.mjs                (no dev server needed)
//      node scripts/seed-scrum180.mjs --reschedule   (TC-180-12, after step 1)
//
// Safe to run again: it deletes and recreates only the events it made
// (matched by their purpose), which also clears their bookings and
// registrations, so it doubles as "reset my test data".
//
// DUMMY(SCRUM-185) D-22: the registration period is set here, not by the
// coordinator's form (SCRUM-185 AC5).
//
// Accounts, all with password TestPass123!:
//   attendee@    {attendee}  Tan Mei Ling   most cases
//   attendee2@   {attendee}  Lim Wei Jie    TC-180-07 (another attendee), TC-180-10
//   attendee3@   {attendee}  no registrations, TC-180-11
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local'), quiet: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_PASSWORD = 'TestPass123!';
const PURPOSE = 'SCRUM-180 manual test';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error(
    'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local before running this script.',
  );
}

// Creates accounts with a known password through the service-role key, so it
// refuses to run against anything but the local stack (same guard as
// scripts/seed-scrum255.mjs).
if (!['127.0.0.1', 'localhost'].includes(new URL(SUPABASE_URL).hostname)) {
  throw new Error(`NEXT_PUBLIC_SUPABASE_URL (${SUPABASE_URL}) is not a local Supabase instance; refusing to run.`);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function check(label, { error }) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

// Dates are Singapore dates, because the app shows and compares them that way.
function singaporeDate(daysFromToday) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
  }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

const ddmmyyyy = (iso) => iso.split('-').reverse().join('/');
const NIGHT = 'Client Appreciation Night';

if (process.argv.includes('--reschedule')) {
  await reschedule();
} else {
  await seed();
}

// --- TC-180-12: move the Client Appreciation Night ---------------------------
async function reschedule() {
  const date = singaporeDate(21);
  const { data: night, error } = await supabase
    .from('event_request')
    .select('id')
    .eq('purpose', PURPOSE)
    .eq('name', NIGHT)
    .single();
  if (error || !night) throw new Error(`Run node scripts/seed-scrum180.mjs first: ${error?.message ?? 'not found'}`);
  // The event and its booking move together, as a reschedule would (B6).
  const moved = { start_time: '19:00', end_time: '23:00' };
  check(
    'reschedule event',
    await supabase
      .from('event_request')
      .update({ proposed_date: date, ...moved })
      .eq('id', night.id),
  );
  check(
    'move booking',
    await supabase
      .from('venue_booking')
      .update({ date, ...moved })
      .eq('event_request_id', night.id),
  );
  console.log(`${NIGHT} moved to ${ddmmyyyy(date)}, 19:00-23:00. Reload My registrations (TC-180-12).`);
}

async function userIdByEmail(email) {
  const { data, error } = await supabase.auth.admin.listUsers({
    perPage: 1000,
  });
  if (error) throw error;
  return data.users.find((user) => user.email === email)?.id;
}

/** Creates the account if missing, then makes it an Attendee with this name. */
async function ensureAttendee(email, fullName) {
  const { error } = await supabase.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error && !error.message.toLowerCase().includes('already been registered')) {
    throw new Error(`create ${email}: ${error.message}`);
  }
  const id = await userIdByEmail(email);
  if (!id) throw new Error(`${email} not found after creating it.`);
  check(
    `profile ${email}`,
    await supabase
      .from('profiles')
      .update({ roles: ['attendee'], full_name: fullName })
      .eq('id', id),
  );
  return id;
}

async function seed() {
  // --- Accounts ---------------------------------------------------------------
  const attendee = await ensureAttendee('attendee@example.com', 'Tan Mei Ling');
  const attendee2 = await ensureAttendee('attendee2@example.com', 'Lim Wei Jie');
  await ensureAttendee('attendee3@example.com', null);

  const organiser = await userIdByEmail('organiser@example.com');
  const coordinator = await userIdByEmail('coordinator@example.com');
  const opsManager = await userIdByEmail('ops-manager@example.com');
  if (!organiser || !coordinator || !opsManager) {
    throw new Error('Run npm run seed:users first: organiser, coordinator or ops-manager is missing.');
  }
  // TC-180-07 looks for the coordinator's name, so give it one if it has none.
  check(
    'coordinator name',
    await supabase.from('profiles').update({ full_name: 'Coordinator A' }).eq('id', coordinator).is('full_name', null),
  );

  // TC-180-07: the event's client organisation, which an attendee must not see.
  check(
    'client',
    await supabase.from('client_organisations').upsert({ name: 'Acme Holdings' }, { onConflict: 'name' }),
  );
  const { data: client } = await supabase
    .from('client_organisations')
    .select('id')
    .eq('name', 'Acme Holdings')
    .single();

  const { data: venueRows, error: venueError } = await supabase.from('venues').select('id, name');
  if (venueError) throw new Error(`venues: ${venueError.message}`);
  const venueId = (name) => {
    const venue = venueRows.find((row) => row.name === name);
    if (!venue) throw new Error(`Venue "${name}" is missing: run npm run db:reset to load supabase/seed.sql.`);
    return venue.id;
  };

  // --- Events -----------------------------------------------------------------
  check('clear old events', await supabase.from('event_request').delete().eq('purpose', PURPOSE));

  // [name, period start, period end (null = no period), event date, times, test cases, extra columns].
  // Offsets are days from today (D).
  const EVENTS = [
    [
      NIGHT,
      -3,
      5,
      16,
      ['18:00', '22:00'],
      'TC-180-01, 06, 07, 09, 12, 15',
      {
        description: 'An evening to thank our clients, with dinner and a short programme.',
        client_organisation_id: client.id,
        clarification_note: 'Check catering budget',
        clarification_requested_by: coordinator,
        clarification_requested_at: new Date().toISOString(),
        equipment_required: true,
        technical_support_notes: 'Wireless microphone',
      },
    ],
    [`${NIGHT} (opens today)`, 0, 5, 17, ['18:00', '22:00'], 'TC-180-02', {}],
    [`${NIGHT} (closes today)`, -5, 0, 17, ['18:00', '22:00'], 'TC-180-02', {}],
    [`${NIGHT} (opens tomorrow)`, 1, 10, 20, ['18:00', '22:00'], 'TC-180-03', {}],
    [`${NIGHT} (opens in 2 days)`, 2, 10, 20, ['18:00', '22:00'], 'TC-180-03', {}],
    [`${NIGHT} (closed yesterday)`, -10, -1, 12, ['18:00', '22:00'], 'TC-180-04', {}],
    [`${NIGHT} (closed 2 days ago)`, -10, -2, 12, ['18:00', '22:00'], 'TC-180-04', {}],
    ['Partner Networking Lunch (no registration)', null, null, 13, ['12:00', '14:00'], 'TC-180-05, 10', {}],
    [
      'Product Launch Briefing',
      -3,
      5,
      18,
      ['10:00', '12:00'],
      'TC-180-08, 09, 13, 15',
      {
        description: 'A first look at the new product line for partners.',
      },
    ],
    [
      'Customer Workshop',
      -3,
      5,
      19,
      ['14:00', '17:00'],
      'TC-180-11 (withdrawn), 17',
      {
        description: 'A hands-on afternoon for customers.',
      },
    ],
    [
      'Year-End Gala',
      -3,
      5,
      30,
      ['19:00', '23:00'],
      'TC-180-14, 16 (cancelled)',
      {
        description: 'The year-end celebration.',
      },
    ],
    // TC-180-16: registration still open, but the event is Completed (set below).
    ['Annual Dinner (completed)', -3, 5, 2, ['19:00', '22:00'], 'TC-180-16 (completed)', {}],
  ];

  const now = new Date().toISOString();
  const rows = EVENTS.map(([name, start, end, eventDay, [startTime, endTime], , extra]) => ({
    name,
    purpose: PURPOSE,
    status: 'confirmed',
    organiser_id: organiser,
    proposed_date: singaporeDate(eventDay),
    start_time: startTime,
    end_time: endTime,
    expected_attendance: 20,
    // SCRUM-182 refuses an event with no capacity as full; give each room for
    // the run so the event pages offer the form rather than "full".
    registration_capacity: 50,
    registration_required: true,
    registration_start_date: start === null ? null : singaporeDate(start),
    registration_end_date: end === null ? null : singaporeDate(end),
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
  const dateOf = (name) => rows.find((row) => row.name === name);

  // --- Venue bookings ---------------------------------------------------------
  // A booking per venue, at the event's own date and times (Customer Workshop has a
  // second one; TC-180-17). Each event that has one is on a day of its own, so no two
  // events clash at the same venue.
  // `times` overrides the event's own, for a second booking at the same venue (TC-180-17).
  function booking(eventName, venueName, status = 'confirmed', times = null) {
    const event = dateOf(eventName);
    return {
      event_request_id: idOf(eventName),
      venue_id: venueId(venueName),
      date: event.proposed_date,
      start_time: times ? times[0] : event.start_time,
      end_time: times ? times[1] : event.end_time,
      status,
      // A released booking always records why, who and when (SCRUM-231).
      ...(status === 'released'
        ? {
            release_reason: 'Replaced by a larger room',
            released_by: coordinator,
            released_at: now,
          }
        : {}),
    };
  }

  check(
    'bookings',
    await supabase.from('venue_booking').insert([
      booking(NIGHT, 'Marina Bay Ballroom'),
      // TC-180-08: two confirmed venues, and a released one that is not shown.
      booking('Product Launch Briefing', 'Marina Bay Ballroom'),
      booking('Product Launch Briefing', 'Bugis Seminar Room'),
      booking('Product Launch Briefing', 'Jurong East Training Room', 'released'),
      booking('Customer Workshop', 'Bugis Seminar Room'),
      // TC-180-17: a second, morning booking at the same venue; the venue is still listed once.
      booking('Customer Workshop', 'Bugis Seminar Room', 'confirmed', ['09:00', '12:00']),
      booking('Year-End Gala', 'Marina Bay Ballroom'),
    ]),
  );

  // --- Registrations made before the run ---------------------------------------
  const registration = (eventName, attendeeId, fullName, email, status = 'registered') => ({
    event_request_id: idOf(eventName),
    attendee_id: attendeeId,
    full_name: fullName,
    email,
    contact_number: '+65 9000 0000',
    status,
  });

  check(
    'registrations',
    await supabase.from('event_registration').insert([
      registration(NIGHT, attendee, 'Tan Mei Ling', 'attendee@example.com'),
      registration('Product Launch Briefing', attendee, 'Tan Mei Ling', 'attendee@example.com'),
      // TC-180-11: withdrawing is SCRUM-184's; the seed sets the status it will write.
      registration('Customer Workshop', attendee, 'Tan Mei Ling', 'attendee@example.com', 'withdrawn'),
      registration('Year-End Gala', attendee, 'Tan Mei Ling', 'attendee@example.com'),
      // TC-180-07, 10: another attendee's registrations.
      registration(NIGHT, attendee2, 'Lim Wei Jie', 'attendee2@example.com'),
      registration('Partner Networking Lunch (no registration)', attendee2, 'Lim Wei Jie', 'attendee2@example.com'),
    ]),
  );

  // TC-180-14: the gala is cancelled after the attendee registered. Cancelling
  // is SCRUM-105's; this sets the status that flow writes.
  check(
    'cancel gala',
    await supabase.from('event_request').update({ status: 'cancelled' }).eq('id', idOf('Year-End Gala')),
  );
  // TC-180-16: completing is SCRUM-104's; this sets the status it writes. Both
  // events have their registration period open, and neither is on Open events.
  check(
    'complete dinner',
    await supabase
      .from('event_request')
      .update({ status: 'completed', completed_at: now })
      .eq('id', idOf('Annual Dinner (completed)')),
  );

  // --- Summary ----------------------------------------------------------------
  console.log(`Seeded ${created.length} events. Today (D) is ${ddmmyyyy(singaporeDate(0))}.`);
  console.log('Sign in as attendee@example.com (attendee2@ or attendee3@ where a case says), password TestPass123!\n');
  for (const [name, start, end, eventDay, [startTime, endTime], cases] of EVENTS) {
    const period =
      start === null
        ? 'no registration period'
        : `registration ${ddmmyyyy(singaporeDate(start))} to ${ddmmyyyy(singaporeDate(end))}`;
    console.log(`${cases.padEnd(32)} ${name}`);
    console.log(`${''.padEnd(32)} event ${ddmmyyyy(singaporeDate(eventDay))} ${startTime}-${endTime}; ${period}`);
    console.log(`${''.padEnd(32)} http://localhost:3000/register-events/${idOf(name)}\n`);
  }
}
