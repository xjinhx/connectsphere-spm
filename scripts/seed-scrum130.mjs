// Seeds SCRUM-130's manual run (TC-130-01 to TC-130-27): the venue search filters.
// Only what those test cases need, and nothing from other stories' seeds.
//
// Run: npm run db:start && npm run db:reset   (seed.sql gives the locations, facilities and features)
//      npm run seed:users                     (organiser@, for TC-130-24's booking)
//      node scripts/seed-scrum130.mjs          (no dev server needed)
//
// Safe to run again: every "S130" venue and the S130 booking's event are
// deleted and recreated.
//
// Venues (the SCRUM-130 tab, row 2), open 07:00 to 24:00, at seed.sql's
// locations, facilities and accessibility features:
//   S130-A  Bugis        max 150  Theatre 120, Banquet 80     Projector, Sound system        Step-free access, Hearing loop
//   S130-B  Jurong East  max 100  Theatre 100, Classroom 100  Projector                      Step-free access
//   S130-C  Marina Bay   max 99   Theatre 99                  Sound system                   (none)
//   S130-D  Bugis        max 200  Banquet 200 (no Theatre)    Projector, Sound system, Whiteboard  Step-free access, Hearing loop
//
// Regression set-ups:
//   TC-130-24  S130-A has a confirmed booking on 10 Nov 2026, 10:00-12:00
//   TC-130-25  S130-D is unavailable on 11 Nov 2026, 14:00-16:30
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PREFIX = 'S130';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local before running this script.');
}
if (!['127.0.0.1', 'localhost'].includes(new URL(SUPABASE_URL).hostname)) {
  throw new Error(`NEXT_PUBLIC_SUPABASE_URL (${SUPABASE_URL}) is not a local Supabase instance; refusing to run.`);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function check(label, { error }) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

async function idsByName(table, names) {
  const { data, error } = await supabase.from(table).select('id, name').in('name', names);
  if (error) throw new Error(`${table}: ${error.message}`);
  const byName = Object.fromEntries(data.map((row) => [row.name, row.id]));
  for (const name of names) {
    if (!byName[name]) throw new Error(`${table} "${name}" not found. Run npm run db:reset first (supabase/seed.sql).`);
  }
  return byName;
}

const location = await idsByName('locations', ['Bugis', 'Jurong East', 'Marina Bay']);
const facility = await idsByName('facilities', ['Projector', 'Sound system', 'Whiteboard']);
const feature = await idsByName('accessibility_features', ['Step-free access', 'Hearing loop']);

// --- Clear the previous run ----------------------------------------------------
check('clear S130 events', await supabase.from('event_request').delete().like('name', `${PREFIX} %`));
check('clear S130 venues', await supabase.from('venues').delete().like('name', `${PREFIX}-%`));

// --- Venues, through the same database function as the add venue form ---------
const VENUES = [
  {
    name: 'S130-A',
    location: 'Bugis',
    max: 150,
    layouts: [
      { layout: 'theatre', capacity: 120 },
      { layout: 'banquet', capacity: 80 },
    ],
    facilities: ['Projector', 'Sound system'],
    features: ['Step-free access', 'Hearing loop'],
  },
  {
    name: 'S130-B',
    location: 'Jurong East',
    max: 100,
    layouts: [
      { layout: 'theatre', capacity: 100 },
      { layout: 'classroom', capacity: 100 },
    ],
    facilities: ['Projector'],
    features: ['Step-free access'],
  },
  {
    name: 'S130-C',
    location: 'Marina Bay',
    max: 99,
    layouts: [{ layout: 'theatre', capacity: 99 }],
    facilities: ['Sound system'],
    features: [],
  },
  {
    name: 'S130-D',
    location: 'Bugis',
    max: 200,
    layouts: [{ layout: 'banquet', capacity: 200 }],
    facilities: ['Projector', 'Sound system', 'Whiteboard'],
    features: ['Step-free access', 'Hearing loop'],
  },
];

const venueId = {};
for (const spec of VENUES) {
  const { data, error } = await supabase.rpc('create_venue', {
    p_name: spec.name,
    p_location_id: location[spec.location],
    p_max_capacity: spec.max,
    p_operating_slots: ['am', 'pm', 'night'],
    p_facility_ids: spec.facilities.map((name) => facility[name]),
    p_accessibility_feature_ids: spec.features.map((name) => feature[name]),
    p_layouts: spec.layouts,
    p_opens_at: '07:00',
    p_closes_at: '24:00',
  });
  if (error) throw new Error(`create ${spec.name}: ${error.message}`);
  venueId[spec.name] = data;
  console.log(`Venue:  ${spec.name}  ${spec.location.padEnd(11)} max ${String(spec.max).padEnd(4)} ${spec.layouts.map((l) => `${l.layout} ${l.capacity}`).join(', ')}`);
}

// --- TC-130-24: S130-A booked on 10 Nov 2026, 10:00-12:00 ---------------------
const { data: users, error: usersError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
if (usersError) throw usersError;
const organiser = users.users.find((user) => user.email === 'organiser@example.com')?.id;
if (!organiser) throw new Error('organiser@example.com not found. Run npm run seed:users first.');

const { data: event, error: eventError } = await supabase
  .from('event_request')
  .insert({ name: `${PREFIX} Booked event`, organiser_id: organiser, proposed_date: '2026-11-10', time_slots: ['am'] })
  .select('id')
  .single();
if (eventError) throw new Error(`insert S130 event: ${eventError.message}`);
check('submit S130 event', await supabase.from('event_request').update({ status: 'submitted' }).eq('id', event.id));
check(
  'book S130-A',
  await supabase.from('venue_booking').insert({
    venue_id: venueId['S130-A'],
    event_request_id: event.id,
    date: '2026-11-10',
    slot: 'am',
    start_time: '10:00',
    end_time: '12:00',
  }),
);
console.log('Booked: S130-A  10 Nov 2026  10:00-12:00  (TC-130-24)');

// --- TC-130-25: S130-D unavailable on 11 Nov 2026, 14:00-16:30 ----------------
check(
  'mark S130-D unavailable',
  await supabase.from('venue_unavailable_slot').insert({
    venue_id: venueId['S130-D'],
    date: '2026-11-11',
    slot: 'pm',
    reason: 'SCRUM-130 manual test',
    start_time: '14:00',
    end_time: '16:30',
  }),
);
console.log('Unavailable: S130-D  11 Nov 2026  14:00-16:30  (TC-130-25)');

console.log('\nDone. Search as coordinator@example.com at http://localhost:3000/venues/search on 10 Dec 2026, 10:00-12:00.');
