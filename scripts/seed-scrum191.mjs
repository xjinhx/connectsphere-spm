// Seeds SCRUM-191's manual run: Reject a change request with a reason.
//
// Run: npm run db:start && npm run db:reset && npm run seed:users
//      node scripts/seed-scrum191.mjs          (dev server: npm run dev)
//
// Safe to run again: every "S191 " event (its change requests, fields and
// notifications go with it) is deleted and recreated, so each run gives you
// fresh Pending requests to reject.
//
// Accounts, password TestPass123!:
//   coordinator@example.com    {coordinator}  the assigned coordinator (A)
//   coordinator-b@example.com  {coordinator}  assigned to the other event only
//   organiser@example.com      {event_organiser}  raised every request
//
// Each event has one Pending change request (Expected attendance 150 -> 180,
// Proposed date 10/11/2026 -> 15/11/2026, reason "Programme updated"). Open it
// as the coordinator at /events/<id>/review, under "Change requests".
//   S191 Reject With Reason   AC1, AC2: reject with a reason; status becomes
//                             Rejected and the reason shows. Then the event's
//                             own attendance (150) and date are unchanged.
//   S191 Notify Organiser     AC3: reject, then sign in as organiser@ and open
//                             Notifications ("Change request rejected", with
//                             the reason) and the event page.
//   S191 Blank Reason         AC4: Confirm rejection with no reason (or only
//                             spaces) is blocked, and "a reason is required".
//   S191 Other Coordinator    coordinator@ is refused on this event (it is
//                             assigned to coordinator B).
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local'), quiet: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_PASSWORD = 'TestPass123!';
const PREFIX = 'S191';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local before running this script.');
}

// Creates accounts with a known password through the service-role key, so it
// refuses to run against anything but the local stack.
if (!['127.0.0.1', 'localhost'].includes(new URL(SUPABASE_URL).hostname)) {
  throw new Error(`NEXT_PUBLIC_SUPABASE_URL (${SUPABASE_URL}) is not a local Supabase instance; refusing to run.`);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function check(label, { error }) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

async function single(label, query) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  if (!data) throw new Error(`${label}: not found.`);
  return data;
}

async function userIdByEmail(email) {
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((user) => user.email === email)?.id;
}

/** Creates the account if missing, then sets its roles and name. */
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
const organiser = await ensureUser('organiser@example.com', ['event_organiser'], 'Organiser');
const coordinatorA = await ensureUser('coordinator@example.com', ['coordinator'], 'Coordinator A');
const coordinatorB = await ensureUser('coordinator-b@example.com', ['coordinator'], 'Coordinator B');
await ensureUser('ops-manager@example.com', ['operations_manager'], 'Ops Manager');

// --- Start clean ------------------------------------------------------------
// change_request.event_request_id is on delete restrict, so the change
// requests (and with them their fields) go before the events.
const existing = await supabase.from('event_request').select('id').like('name', `${PREFIX} %`);
check('read existing S191 events', existing);
const existingIds = (existing.data ?? []).map((row) => row.id);
if (existingIds.length > 0) {
  check('clear S191 notifications', await supabase.from('notifications').delete().in('event_request_id', existingIds));
  check('clear S191 change requests', await supabase.from('change_request').delete().in('event_request_id', existingIds));
}
check('clear S191 events', await supabase.from('event_request').delete().like('name', `${PREFIX} %`));

/** One Planning event, assigned to `coordinator`, raised by the organiser. */
async function createEvent(key, { coordinator, date, expectedAttendance }) {
  const name = `${PREFIX} ${key}`;
  const now = new Date().toISOString();
  const event = await single(
    `insert ${name}`,
    supabase
      .from('event_request')
      .insert({
        name,
        purpose: 'SCRUM-191 manual test',
        description: 'Seeded by scripts/seed-scrum191.mjs',
        organiser_id: organiser,
        status: 'planning',
        proposed_date: date,
        start_time: '10:00',
        end_time: '12:00',
        expected_attendance: expectedAttendance,
        submitted_at: now,
        decision: 'approved',
        decided_by: coordinator,
        decided_at: now,
        coordinator_id: coordinator,
        assigned_by: coordinator,
        assigned_at: now,
      })
      .select('id, reference')
      .single(),
  );
  return { ...event, name };
}

/** Raises a Pending change request directly (the app's own raise route does the same writes). */
async function raiseRequest(event, reason, fields) {
  const request = await single(
    `change request ${event.name}`,
    supabase
      .from('change_request')
      .insert({ event_request_id: event.id, organiser_id: organiser, reason })
      .select('id')
      .single(),
  );
  check(
    `change request fields ${event.name}`,
    await supabase.from('change_request_field').insert(
      fields.map((f) => ({
        change_request_id: request.id,
        field: f.field,
        current_value: f.currentValue,
        proposed_value: f.proposedValue,
      })),
    ),
  );
  return request;
}

/** The in-app notification SCRUM-187 AC1 sends the assigned coordinator on a raise. */
async function notifyChangeRequested(event, recipient, reason) {
  check(
    `notification ${event.name}`,
    await supabase.from('notifications').insert({
      recipient_id: recipient,
      type: 'change_requested',
      event_request_id: event.id,
      message: `A change was requested for "${event.name}": ${reason}`,
    }),
  );
}

// --- Events -----------------------------------------------------------------
const pendingFields = [
  { field: 'expectedAttendance', currentValue: 150, proposedValue: 180 },
  { field: 'proposedDate', currentValue: '2026-11-10', proposedValue: '2026-11-15' },
];
const events = [];
for (const [key, coordinator, coordinatorName] of [
  ['Reject With Reason', coordinatorA, 'coordinator@example.com'],
  ['Notify Organiser', coordinatorA, 'coordinator@example.com'],
  ['Blank Reason', coordinatorA, 'coordinator@example.com'],
  ['Other Coordinator', coordinatorB, 'coordinator-b@example.com'],
]) {
  const event = await createEvent(key, { coordinator, date: '2026-11-10', expectedAttendance: 150 });
  await raiseRequest(event, 'Programme updated', pendingFields);
  await notifyChangeRequested(event, coordinator, 'Programme updated');
  events.push({ ...event, coordinatorName });
}

console.log(`Ready. Password for every account: ${TEST_PASSWORD}\n`);
console.log('  coordinator@example.com    rejects on the first three events');
console.log('  coordinator-b@example.com  owns the fourth; coordinator@ must be refused on it');
console.log('  organiser@example.com      checks the notification and event page after a rejection\n');
for (const event of events) {
  console.log(`  ${event.reference}  ${event.name.padEnd(28)} ${event.coordinatorName.padEnd(26)} /events/${event.id}/review`);
}
