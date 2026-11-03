// Seeds SCRUM-188's manual run (TC-188-01 to TC-188-04): Review a change request.
//
// Run: npm run db:start && npm run db:reset && npm run seed:users
//      node scripts/seed-scrum188.mjs          (no dev server needed)
//
// Safe to run again: every "S188 " event (its change requests, fields and
// notifications go with it) is deleted and recreated.
//
// Accounts, password TestPass123!:
//   coordinator@example.com    {coordinator}  the assigned coordinator (A)
//   coordinator-b@example.com  {coordinator}  assigned to the other event only
//   ops-manager@example.com    {operations_manager}
//   organiser@example.com      {event_organiser}
//
// Data the test cases open:
//   TC-188-01, 02  "S188 Product Launch": a Pending change request touching two
//                  fields (Expected attendance 150 -> 180, Proposed date
//                  10/11/2026 -> 15/11/2026), reason "Programme updated", and
//                  the coordinator's in-app "Change requested" notification
//                  (TC-188-02 opens the request from that notification).
//   TC-188-03      "S188 Other Coordinator Event": assigned to coordinator B,
//                  with its own Pending change request. Coordinator A must be
//                  refused when opening it.
//   TC-188-04      "S188 Equipment Change": one change request whose fields are
//                  an equipment list (current Projector x 1, proposed
//                  Projector x 1 and Mic set x 2) and the accessibility
//                  features list (read by name, not id).
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local'), quiet: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_PASSWORD = 'TestPass123!';
const PREFIX = 'S188';

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
check('read existing S188 events', existing);
const existingIds = (existing.data ?? []).map((row) => row.id);
if (existingIds.length > 0) {
  check('clear S188 notifications', await supabase.from('notifications').delete().in('event_request_id', existingIds));
  check('clear S188 change requests', await supabase.from('change_request').delete().in('event_request_id', existingIds));
}
check('clear S188 events', await supabase.from('event_request').delete().like('name', `${PREFIX} %`));

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
        purpose: 'SCRUM-188 manual test',
        description: 'Seeded by scripts/seed-scrum188.mjs',
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

// --- TC-188-01, TC-188-02 ---------------------------------------------------
const launch = await createEvent('Product Launch', { coordinator: coordinatorA, date: '2026-11-10', expectedAttendance: 150 });
await raiseRequest(launch, 'Programme updated', [
  { field: 'expectedAttendance', currentValue: 150, proposedValue: 180 },
  { field: 'proposedDate', currentValue: '2026-11-10', proposedValue: '2026-11-15' },
]);
await notifyChangeRequested(launch, coordinatorA, 'Programme updated');

// --- TC-188-03 --------------------------------------------------------------
const other = await createEvent('Other Coordinator Event', { coordinator: coordinatorB, date: '2026-11-12', expectedAttendance: 80 });
await raiseRequest(other, 'Guest list grew', [{ field: 'expectedAttendance', currentValue: 80, proposedValue: 95 }]);
await notifyChangeRequested(other, coordinatorB, 'Guest list grew');

// --- TC-188-04 --------------------------------------------------------------
const features = await supabase.from('accessibility_features').select('id, name').order('name').limit(2);
check('read accessibility features', features);
if ((features.data ?? []).length < 2) throw new Error('Need at least two accessibility_features rows (supabase/seed.sql).');
const [featureOne, featureTwo] = features.data;

const equipment = await createEvent('Equipment Change', { coordinator: coordinatorA, date: '2026-11-14', expectedAttendance: 60 });
await raiseRequest(equipment, 'More audio-visual needs', [
  {
    field: 'equipmentItems',
    currentValue: [{ item: 'Projector', quantity: 1 }],
    proposedValue: [
      { item: 'Projector', quantity: 1 },
      { item: 'Mic set', quantity: 2 },
    ],
  },
  { field: 'accessibilityFeatureIds', currentValue: [featureOne.id], proposedValue: [featureOne.id, featureTwo.id] },
]);
await notifyChangeRequested(equipment, coordinatorA, 'More audio-visual needs');

console.log('Ready. Password for every account: ' + TEST_PASSWORD + '\n');
console.log('  coordinator@example.com    TC-188-01, 02, 04 (assigned to the first and third event)');
console.log('  coordinator-b@example.com  owns the second event; coordinator@ must be refused on it (TC-188-03)\n');
for (const event of [launch, other, equipment]) {
  console.log(`  ${event.reference}  ${event.name.padEnd(32)} /events/${event.id}/review`);
}
console.log(`\n  Accessibility features on ${equipment.name}: ${featureOne.name} -> ${featureOne.name}, ${featureTwo.name}`);
