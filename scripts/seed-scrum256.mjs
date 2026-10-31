// Seeds SCRUM-256's manual run (TC-256-04, TC-256-05): the two accounts that
// hold the Safety Officer role with another one. Everything else in the
// SCRUM-256 run uses safety-officer@example.com (npm run seed:users) and any
// Confirmed event awaiting a safety check (e.g. node scripts/seed-b3.mjs).
//
// Run: npm run db:start && npm run seed:users
//      node scripts/seed-scrum256.mjs          (no dev server needed)
//
// Safe to run again: the accounts are updated in place.
//
// Accounts, password TestPass123!, roles stored in this order:
//   coord-safety@  {coordinator, safety_officer}         -> lands on /safety-checks (TC-256-04)
//   lead-safety@   {safety_officer, operations_manager}  -> lands on /assignment-queue (TC-256-05)
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local') });

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

/** Creates the account if missing, then sets its roles (in this order) and name. */
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

const ACCOUNTS = [
  ['coord-safety@example.com', ['coordinator', 'safety_officer'], 'Coord Safety'],
  ['lead-safety@example.com', ['safety_officer', 'operations_manager'], 'Lead Safety'],
];

for (const [email, roles, fullName] of ACCOUNTS) {
  await ensureUser(email, roles, fullName);
  console.log(`Ready: ${email.padEnd(26)} ${roles.join(', ')} ("${fullName}")`);
}
console.log('\nPassword for both: TestPass123!');
