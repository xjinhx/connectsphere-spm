// Seeds SCRUM-250's manual run (TC-250-01 to TC-250-07): the Event Organiser
// nav and back links. Only what those test cases need, and nothing from other
// stories' seeds.
//
// Run: npm run db:start && npm run db:reset
//      node scripts/seed-scrum250.mjs          (no dev server needed)
//
// Safe to run again: the accounts are updated in place, and every "S250" event
// is deleted and recreated.
//
// Accounts, all with password TestPass123!:
//   organiser@     Event Organiser, Harbour Events Pte Ltd, who owns both S250 events
//   coordinator@   Event Coordinator (TC-250-05)
//
// Events:
//   S250 Draft Breakfast   Draft, not submitted (TC-250-03, TC-250-07)
//   S250 Harbour Gala      Submitted (TC-250-04)
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_PASSWORD = 'TestPass123!';
const PREFIX = 'S250';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script.');
}

// Creates accounts with a known password through the service-role key, so it
// refuses to run against anything but the local stack (same guard as
// scripts/seed-scrum110.mjs).
if (!['127.0.0.1', 'localhost'].includes(new URL(SUPABASE_URL).hostname)) {
  throw new Error(`NEXT_PUBLIC_SUPABASE_URL (${SUPABASE_URL}) is not a local Supabase instance; refusing to run.`);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function check(label, { error }) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

async function userIdByEmail(email) {
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((user) => user.email === email)?.id;
}

async function ensureUser(email, roles, fullName, clientOrganisationId = null) {
  const { error } = await supabase.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });
  if (error && !error.message.toLowerCase().includes('already been registered')) {
    throw new Error(`create ${email}: ${error.message}`);
  }
  const id = await userIdByEmail(email);
  if (!id) throw new Error(`${email} not found after creating it.`);
  check(
    `profile ${email}`,
    await supabase
      .from('profiles')
      .update({ roles, full_name: fullName, client_organisation_id: clientOrganisationId })
      .eq('id', id),
  );
  return id;
}

async function ensureOrganisation(name) {
  const { data: found } = await supabase.from('client_organisations').select('id').eq('name', name).maybeSingle();
  if (found) return found.id;
  const { data, error } = await supabase.from('client_organisations').insert({ name }).select('id').single();
  if (error) throw new Error(`organisation ${name}: ${error.message}`);
  return data.id;
}

/** Today in Singapore plus `days`, as YYYY-MM-DD. */
function daysAhead(days) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// --- Organisation and accounts -----------------------------------------------
const harbour = await ensureOrganisation('Harbour Events Pte Ltd');

const organiser = await ensureUser('organiser@example.com', ['event_organiser'], 'Organiser', harbour);
await ensureUser('coordinator@example.com', ['coordinator'], 'Coordinator A');
console.log('Ready: organiser@example.com, coordinator@example.com');

// --- Events -------------------------------------------------------------------
check('clear S250 events', await supabase.from('event_request').delete().like('name', `${PREFIX} %`));

async function createEvent(name, date) {
  const { data, error } = await supabase
    .from('event_request')
    .insert({
      name,
      organiser_id: organiser,
      client_organisation_id: harbour,
      purpose: 'Client event',
      description: `${name}, test data for SCRUM-250`,
      proposed_date: date,
      start_time: '10:00',
      end_time: '12:00',
      expected_attendance: 150,
    })
    .select('id')
    .single();
  if (error) throw new Error(`insert ${name}: ${error.message}`);
  return data.id;
}

await createEvent(`${PREFIX} Draft Breakfast`, daysAhead(28));
const gala = await createEvent(`${PREFIX} Harbour Gala`, daysAhead(35));
check('submit S250 Harbour Gala', await supabase.from('event_request').update({ status: 'submitted' }).eq('id', gala));

const { data: events } = await supabase.from('event_request').select('id, reference, name, status').like('name', `${PREFIX} %`).order('name');
for (const event of events) console.log(`Event:  ${event.reference}  ${event.name.padEnd(22)} ${event.status.padEnd(10)} /events/${event.id}`);

console.log(`\nDone. Password for every account: ${TEST_PASSWORD}`);
