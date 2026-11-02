// Seeds SCRUM-255's manual run (TC-255-01 to TC-255-08): Attendee Navigation.
//
// Run: npm run db:start && npm run db:reset && npm run seed:users
//      node scripts/seed-scrum255.mjs          (no dev server needed)
//
// Safe to run again: the accounts are updated in place, and the events come
// from SCRUM-181's seed, which deletes and recreates its own.
//
// Accounts, all with password TestPass123!:
//   attendee@            {attendee}                    TC-255-01, 04 to 08
//   organiser@           {event_organiser}             TC-255-02
//   venue-staff@         {venue_staff}                 TC-255-02
//   attendee-organiser@  {attendee, event_organiser}   TC-255-03, stored with
//                        Attendee first; lands as Event Organiser (CL-56)
//
// Events (TC-255-04, 06 to 08): SCRUM-181's registration events, one per
// registration state, from scripts/seed-event-registration-test-data.mjs. It
// prints each event's address: Open events does not list them yet (SCRUM-180).
import { execFileSync } from 'child_process';
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local'), quiet: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_PASSWORD = 'TestPass123!';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local before running this script.');
}

// Creates accounts with a known password through the service-role key, so it
// refuses to run against anything but the local stack (same guard as
// scripts/seed-scrum249.mjs).
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

/** Creates the account if missing, then sets its roles (in this order) and name (null = none). */
async function ensureUser(email, roles, fullName) {
  const { error } = await supabase.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });
  if (error && !error.message.toLowerCase().includes('already been registered')) {
    throw new Error(`create ${email}: ${error.message}`);
  }
  const id = await userIdByEmail(email);
  if (!id) throw new Error(`${email} not found after creating it.`);
  check(`profile ${email}`, await supabase.from('profiles').update({ roles, full_name: fullName }).eq('id', id));
}

// --- Accounts ---------------------------------------------------------------
const ACCOUNTS = [
  ['attendee@example.com', ['attendee'], 'Tan Mei Ling'],
  ['organiser@example.com', ['event_organiser'], 'Organiser'],
  ['venue-staff@example.com', ['venue_staff'], null],
  ['attendee-organiser@example.com', ['attendee', 'event_organiser'], null],
];

for (const [email, roles, fullName] of ACCOUNTS) {
  await ensureUser(email, roles, fullName);
  console.log(`Ready: ${email.padEnd(32)} {${roles.join(', ')}}`);
}
console.log(`All passwords: ${TEST_PASSWORD}\n`);

// --- Events -----------------------------------------------------------------
execFileSync(process.execPath, [resolve(process.cwd(), 'scripts/seed-event-registration-test-data.mjs')], {
  stdio: 'inherit',
});
