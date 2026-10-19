// Seeds the preconditions for SCRUM-240 AC5's manual run (TC-240-14, 15, 16),
// now that SCRUM-160's equipment request page is merged. Run after
// `npm run db:reset`:
//
//   node scripts/seed-scrum240-ac5.mjs
//
// It creates (or repairs) the three accounts it needs, three catalogue items
// with the statuses TC-240-16 asks for, and one event in Planning assigned to
// the coordinator, then prints the URLs and the console snippet for TC-240-15.
//
// Safe to run again: the catalogue items are matched by name and reset to the
// expected quantity and status, and the event is deleted and recreated by name,
// which also clears any equipment request lines added to it.
//
// It sets coordinator@example.com back to the single role `coordinator`, so the
// AC5 screenshots cannot be read as a Technical Support account choosing its
// own catalogue items. TC-240-09's multi-role run is already executed; re-run
// its SQL if you need that account dual-role again.
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
const EVENT_NAME = 'SCRUM-240 AC5 manual test';

function check(label, { error }) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

async function userIdByEmail(email) {
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((user) => user.email === email)?.id;
}

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

/** Singapore dates, because the app shows and compares them that way. */
function singaporeDate(daysFromToday) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

// --- Accounts ---------------------------------------------------------------
const coordinator = await ensureUser('coordinator@example.com', ['coordinator'], 'Coordinator A');
const techSupport = await ensureUser('tech-support@example.com', ['technical_support'], 'Tech Support');
const organiser = await ensureUser('organiser@example.com', ['event_organiser'], 'Organiser');
const opsManager = await ensureUser('ops-manager@example.com', ['operations_manager'], 'Ops Manager');

// --- Catalogue --------------------------------------------------------------
// EQ-2 and EQ-3 carry the statuses TC-240-16 checks are still offered to a
// coordinator: AC5 limits the choice to items that exist, not to items free.
const ITEMS = [
  { name: 'Projector P-100', category: 'av', quantity: 10, current_location: 'Bugis Store Room', operational_status: 'available' },
  { name: 'Wireless Mic WM-3', category: 'av', quantity: 4, current_location: 'Bugis Store Room', operational_status: 'damaged' },
  { name: 'Lectern LC-1', category: 'furniture', quantity: 5, current_location: 'Marina Bay Store Room', operational_status: 'under_maintenance' },
];

for (const item of ITEMS) {
  const { data, error } = await supabase.from('equipment').select('id').eq('name', item.name).maybeSingle();
  if (error) throw error;
  if (data) {
    check(`update ${item.name}`, await supabase.from('equipment').update(item).eq('id', data.id));
  } else {
    check(`insert ${item.name}`, await supabase.from('equipment').insert({ ...item, created_by: techSupport }));
  }
}

const { data: catalogue, error: catalogueError } = await supabase
  .from('equipment')
  .select('id, name, operational_status, quantity')
  .order('name');
if (catalogueError) throw catalogueError;

// --- Event ------------------------------------------------------------------
// Planning, assigned to the coordinator: SCRUM-160 AC1 needs both before the
// equipment request page lets a line be added.
check(`clear previous ${EVENT_NAME}`, await supabase.from('event_request').delete().eq('name', EVENT_NAME));

const now = new Date().toISOString();
const { data: event, error: eventError } = await supabase
  .from('event_request')
  .insert({
    name: EVENT_NAME,
    purpose: 'SCRUM-240 AC5 manual test',
    description: 'Seeded by scripts/seed-scrum240-ac5.mjs',
    organiser_id: organiser,
    status: 'planning',
    proposed_date: singaporeDate(14),
    // Clock times, not slots (Week 7 change 1).
    start_time: '10:00',
    end_time: '12:00',
    expected_attendance: 50,
    submitted_at: now,
    decision: 'approved',
    decided_by: opsManager,
    decided_at: now,
    coordinator_id: coordinator,
    assigned_by: opsManager,
    assigned_at: now,
  })
  .select('id, name, reference, status, proposed_date')
  .single();
if (eventError) throw new Error(`insert event: ${eventError.message}`);

// --- What to do with it -----------------------------------------------------
const unknownId = '00000000-0000-4000-8000-000000000000';

console.log(`\nAll passwords: ${TEST_PASSWORD}`);
console.log('Catalogue:');
for (const item of catalogue) {
  console.log(`  ${item.name.padEnd(20)} qty ${String(item.quantity).padEnd(3)} ${item.operational_status}`);
}
console.log(`\nEvent: ${event.name} (${event.reference}) — ${event.status}, ${event.proposed_date}`);
console.log(`  coordinator@example.com is its assigned coordinator\n`);
console.log('TC-240-14 / TC-240-15 (UI half)  sign in as coordinator@example.com, then open');
console.log(`  http://localhost:3000/events/${event.id}/equipment`);
console.log('TC-240-16  sign in as tech-support@example.com to screenshot the statuses at');
console.log('  http://localhost:3000/equipment');
console.log('\nTC-240-15 (API half) — devtools console, signed in as the coordinator:');
console.log(
  `  await (await fetch('/api/event-requests/${event.id}/equipment-request/lines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ equipmentId: '${unknownId}', quantity: 1 }) })).json()`,
);
console.log('');
