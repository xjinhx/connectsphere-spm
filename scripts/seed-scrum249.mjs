// Seeds SCRUM-249's manual run (TC-249-01 to TC-249-29): the shared header.
// Only what those test cases need, and nothing from other stories' seeds.
//
// Run: npm run db:start && npm run db:reset   (seed.sql gives the venues for TC-249-01)
//      node scripts/seed-scrum249.mjs          (no dev server needed)
//
// Safe to run again: the accounts are updated in place, and every "S249" event
// (and its notifications) is deleted and recreated.
//
// Accounts, all with password TestPass123!:
//   One per role (TC-249-12, 15, 23, 25 to 27):
//     organiser@, coordinator@ ("Coordinator A"), ops-manager@, venue-staff@,
//     tech-support@ ("Tech Support"), attendee@, safety-officer@
//   No name recorded (TC-249-09, 11):            coordinator-b@
//   More than one role (TC-249-14, 18 to 22, 24), stored in this order:
//     coord-venue@  {coordinator, venue_staff}         -> lands as Venue Staff
//     coord-tech@   {coordinator, technical_support}   -> lands as Technical Support Staff
//     lead-coord@   {coordinator, operations_manager}  -> lands as Event Coordinator Lead
//
// Notifications for coordinator@ (TC-249-05 to 07, 28, 29): five submitted
// events S249 Event 1 to 5, each assigned to Coordinator A, each with a
// "You have been assigned to ..." notification. Events 1 and 2 are already
// read, so the bell starts at 3.
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_PASSWORD = 'TestPass123!';
const PREFIX = 'S249';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local before running this script.');
}

// Creates accounts with a known password through the service-role key, so it
// refuses to run against anything but the local stack (same guard as
// scripts/seed-scrum232.mjs).
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
  return id;
}

// --- Accounts ---------------------------------------------------------------
const ACCOUNTS = [
  ['organiser@example.com', ['event_organiser'], 'Organiser'],
  ['coordinator@example.com', ['coordinator'], 'Coordinator A'],
  ['ops-manager@example.com', ['operations_manager'], 'Ops Manager'],
  ['venue-staff@example.com', ['venue_staff'], null],
  ['tech-support@example.com', ['technical_support'], 'Tech Support'],
  ['attendee@example.com', ['attendee'], null],
  ['safety-officer@example.com', ['safety_officer'], null],
  ['coordinator-b@example.com', ['coordinator'], null],
  ['coord-venue@example.com', ['coordinator', 'venue_staff'], null],
  ['coord-tech@example.com', ['coordinator', 'technical_support'], null],
  ['lead-coord@example.com', ['coordinator', 'operations_manager'], null],
];

const ids = {};
for (const [email, roles, fullName] of ACCOUNTS) {
  ids[email] = await ensureUser(email, roles, fullName);
  console.log(`Ready: ${email.padEnd(28)} ${roles.join(', ')}${fullName ? ` ("${fullName}")` : ''}`);
}

// --- Events and notifications for Coordinator A -------------------------------
check('clear S249 events', await supabase.from('event_request').delete().like('name', `${PREFIX} %`));

const coordinator = ids['coordinator@example.com'];
const lead = ids['ops-manager@example.com'];
const organiser = ids['organiser@example.com'];

for (let n = 1; n <= 5; n += 1) {
  const name = `${PREFIX} Event ${n}`;

  // The real order of events: drafted, submitted, then assigned. The database
  // stamps submitted_at and assigned_at itself on those two updates.
  const { data: event, error } = await supabase
    .from('event_request')
    .insert({ name, organiser_id: organiser, purpose: `${name}, test data for the SCRUM-249 header` })
    .select('id')
    .single();
  if (error) throw new Error(`insert ${name}: ${error.message}`);

  check(`submit ${name}`, await supabase.from('event_request').update({ status: 'submitted' }).eq('id', event.id));
  check(
    `assign ${name}`,
    await supabase.from('event_request').update({ coordinator_id: coordinator, assigned_by: lead }).eq('id', event.id),
  );

  const { data: saved, error: readError } = await supabase
    .from('event_request')
    .select('reference')
    .eq('id', event.id)
    .single();
  if (readError) throw new Error(`read ${name}: ${readError.message}`);

  // Same type and wording as SCRUM-94's assignment notification.
  check(
    `notify ${name}`,
    await supabase.from('notifications').insert({
      recipient_id: coordinator,
      type: 'coordinator_assigned',
      event_request_id: event.id,
      message: `You have been assigned to ${saved.reference} (${name}).`,
      read_at: n <= 2 ? new Date().toISOString() : null,
    }),
  );
  console.log(`Event:  ${saved.reference}  ${name}  ${n <= 2 ? 'read' : 'unread'}`);
}

console.log(`
Done. Password for every account: ${TEST_PASSWORD}
coordinator@ has 5 notifications: 3 unread, 2 read (bell shows 3).
Venues come from supabase/seed.sql (npm run db:reset).`);
