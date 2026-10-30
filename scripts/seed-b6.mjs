// Seeds the manual run of SCRUM-187 (basket B6) from the Sprint 4 test case
// sheet (SCRUM-187 tab, "Seed (planned, scripts/seed-b6.mjs)" note).
// Needs 20261028090000_change_request applied (`npm run db:reset` after
// pulling it) and `npm run seed:users`.
//
//   node scripts/seed-b6.mjs        Every S187 event (resets them all)
//
// Each case has its own event, named as on the sheet (S187-A ...). Every
// event not Draft/Cancelled/Completed is assigned to coordinator@example.com,
// raised by organiser@example.com. colleague@example.com shares organiser's
// client organisation but owns nothing (TC-187-07, AC4).
//
// TC-187-11/12 depend on SCRUM-190/191 (approve/reject) actually deciding a
// request; neither is built yet, so S187-H and S187-I seed their decision
// directly in Postgres (DUMMY(SCRUM-190)/(SCRUM-191) D-26, docs/dummies.md) -
// same pattern as tests/integration/change-request.test.ts's seedDecision.
// Re-run both manual cases once SCRUM-190/191 merge.
//
// S187-J, S187-K, S187-L cover CL-61 (PO clarification, 24/10/2026): J
// (Approved) and K (Preparation) extend the status scope (Planning is
// already S187-I); L exercises the full field scope (name,
// registrationRequired), not just the SCRUM-111/190 "significant" subset.
//
// Safe to run again: every "S187 " event (its change requests and fields go
// with it, via the change_request_id cascade) is deleted first.
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local before running this script.');
}
if (!['127.0.0.1', 'localhost'].includes(new URL(supabaseUrl).hostname)) {
  throw new Error("Refusing to run against anything but 127.0.0.1/localhost. Point .env.local at `npm run db:start`'s Supabase.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey);
const TEST_PASSWORD = 'TestPass123!';
const PREFIX = 'S187';
const CLIENT_ORGANISATION_NAME = 'Seed Co (SCRUM-187)';

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

async function ensureUser(email, roles, fullName, clientOrganisationId = null) {
  const { error } = await supabase.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });
  if (error && !error.message.toLowerCase().includes('already been registered')) {
    throw new Error(`create ${email}: ${error.message}`);
  }
  const id = await userIdByEmail(email);
  if (!id) throw new Error(`${email} not found after creating it.`);
  check(
    `profile ${email}`,
    await supabase.from('profiles').update({ roles, full_name: fullName, client_organisation_id: clientOrganisationId }).eq('id', id),
  );
  return id;
}

// --- Client organisation -----------------------------------------------------
const clientOrganisation = await single(
  `client organisation ${CLIENT_ORGANISATION_NAME}`,
  supabase.from('client_organisations').upsert({ name: CLIENT_ORGANISATION_NAME }, { onConflict: 'name' }).select('id').single(),
);
const clientOrganisationId = clientOrganisation.id;

// --- Accounts ---------------------------------------------------------------
const organiser = await ensureUser('organiser@example.com', ['event_organiser'], 'Organiser', clientOrganisationId);
// TC-187-07 (AC4): same client organisation, not responsible for any S187 event.
await ensureUser('colleague@example.com', ['event_organiser'], 'Colleague', clientOrganisationId);
const coordinator = await ensureUser('coordinator@example.com', ['coordinator'], 'Coordinator A');

// --- Start clean --------------------------------------------------------------
// change_request.event_request_id is on delete restrict (SCRUM-190/191 still
// need to read it back after the event moves on), so any change request
// raised against an S187 event - including ones raised by hand while manually
// testing - must go first, or the event delete below is refused.
const existingS187Events = await supabase.from('event_request').select('id').like('name', `${PREFIX} %`);
check('read existing S187 events', existingS187Events);
const existingS187EventIds = (existingS187Events.data ?? []).map((row) => row.id);
if (existingS187EventIds.length > 0) {
  check('clear S187 change requests', await supabase.from('change_request').delete().in('event_request_id', existingS187EventIds));
}
check('clear S187 events', await supabase.from('event_request').delete().like('name', `${PREFIX} %`));

/**
 * One event, named `${PREFIX} ${key}`. `status` drives which columns are
 * filled, the same guards event_request's own check constraints enforce
 * (submitted_at, decision, coordinator assignment) - matches the pattern in
 * scripts/seed-b3.mjs and tests/integration/change-request.test.ts.
 */
async function createEvent(key, { status, expectedAttendance = 150, date = '2026-11-21', assign = true } = {}) {
  const name = `${PREFIX} ${key}`;
  const now = new Date().toISOString();
  const submitted = status !== 'draft';
  const decided = ['approved', 'planning', 'confirmed', 'preparation', 'completed', 'rejected'].includes(status);
  const event = await single(
    `insert ${name}`,
    supabase
      .from('event_request')
      .insert({
        name,
        purpose: 'SCRUM-187 manual test',
        description: 'Seeded by scripts/seed-b6.mjs',
        organiser_id: organiser,
        client_organisation_id: clientOrganisationId,
        status,
        proposed_date: date,
        start_time: '10:00',
        end_time: '12:00',
        expected_attendance: expectedAttendance,
        submitted_at: submitted ? now : null,
        decision: decided ? 'approved' : null,
        decided_by: decided ? coordinator : null,
        decided_at: decided ? now : null,
        coordinator_id: submitted && assign ? coordinator : null,
        assigned_by: submitted && assign ? coordinator : null,
        assigned_at: submitted && assign ? now : null,
      })
      .select('id, reference')
      .single(),
  );
  return { ...event, key, name };
}

/**
 * Raises a Pending change request directly (bypassing the API, which is fine
 * for seed data). `createdAt` defaults to now, same as a real raise; pass an
 * explicit one when the request is about to be seeded a decision dated in
 * the past (S187-H), so "Raised" stays before "Decided" - found manually
 * testing TC-187-11, where created_at (seed run time) ended up after the
 * sheet's fixed 23/10/2026 decision date.
 */
async function raiseRequest(event, reason, fields, createdAt = new Date().toISOString()) {
  const request = await single(
    `change request ${event.name}`,
    supabase.from('change_request').insert({ event_request_id: event.id, organiser_id: organiser, reason, created_at: createdAt }).select('id').single(),
  );
  check(
    `change request fields ${event.name}`,
    await supabase
      .from('change_request_field')
      .insert(fields.map((f) => ({ change_request_id: request.id, field: f.field, current_value: f.currentValue, proposed_value: f.proposedValue }))),
  );
  return { id: request.id, createdAt };
}

/**
 * DUMMY(SCRUM-190) D-26, DUMMY(SCRUM-191) D-26: stands in for SCRUM-190/191's
 * own write. See docs/dummies.md.
 *
 * Refuses a decision dated before the request's own raiseRequest(createdAt) -
 * found manually testing TC-187-11 (28/10/2026), where a hardcoded decidedAt
 * ended up before the created_at this script happened to insert at. The real
 * SCRUM-190/191 write can never do this (a decision only ever happens after
 * the request it decides already exists); this guard is purely so a future
 * edit to this file's hardcoded sample dates can't reintroduce the same
 * seeding mistake silently.
 */
async function seedDecision({ id, createdAt }, { status, decidedAt, reason }) {
  if (new Date(decidedAt).getTime() < new Date(createdAt).getTime()) {
    throw new Error(
      `seedDecision: decidedAt (${decidedAt}) is before this request's createdAt (${createdAt}) - a request cannot be decided before it was raised. Pass raiseRequest() a createdAt earlier than decidedAt.`,
    );
  }
  check(
    `decision ${id}`,
    await supabase.from('change_request').update({ status, decided_by: coordinator, decided_at: decidedAt, decision_reason: reason }).eq('id', id),
  );
}

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const tomorrowDate = tomorrow.toISOString().slice(0, 10);

const created = [];

// TC-187-01, TC-187-03, TC-187-04, TC-187-10: a Submitted event, nothing raised yet.
created.push(await createEvent('A', { status: 'submitted' }));

// TC-187-02: a Confirmed event.
created.push(await createEvent('B', { status: 'confirmed' }));

// TC-187-05: a Draft event (organiser edits it directly, no change request).
created.push(await createEvent('C', { status: 'draft', assign: false }));

// TC-187-06: Submitted, dated tomorrow - no cut-off applies.
created.push(await createEvent('D', { status: 'submitted', date: tomorrowDate }));

// TC-187-07: Submitted, raised by organiser; colleague is not responsible for it.
created.push(await createEvent('E', { status: 'submitted' }));

// TC-187-08: Cancelled.
created.push(await createEvent('F', { status: 'cancelled', assign: false }));

// TC-187-15: CL-61 widens status scope - Approved and Preparation too
// (Planning is already exercised by S187-I below).
created.push(await createEvent('J', { status: 'approved' }));
created.push(await createEvent('K', { status: 'preparation' }));

// TC-187-16: CL-61 widens field scope to the full event-request set - a
// plain text field (name) and a boolean one (registrationRequired).
created.push(await createEvent('L', { status: 'submitted' }));

// TC-187-09: Completed.
created.push(await createEvent('G', { status: 'completed', assign: false }));

// TC-187-11: Submitted, one change request seeded Approved with a decision date and reason.
// Raised a day before its 23/10/2026 decision (the sheet's own test data),
// so "Raised" reads before "Decided" regardless of when this script runs.
const h = await createEvent('H', { status: 'submitted' });
const hRequestId = await raiseRequest(
  h,
  'Matches updated programme',
  [{ field: 'expectedAttendance', currentValue: 150, proposedValue: 220 }],
  '2026-10-22T10:00:00+08:00',
);
await seedDecision(hRequestId, { status: 'approved', decidedAt: '2026-10-23T00:00:00+08:00', reason: 'Matches updated programme' });
created.push(h);

// TC-187-12: Planning, one change request seeded Approved with its proposed
// expected attendance already applied to the event (SCRUM-190's apply step).
const i = await createEvent('I', { status: 'planning', expectedAttendance: 220 });
const iRequestId = await raiseRequest(i, 'Extra guests confirmed', [
  { field: 'expectedAttendance', currentValue: 150, proposedValue: 220 },
]);
await seedDecision(iRequestId, { status: 'approved', decidedAt: new Date().toISOString(), reason: 'Extra guests confirmed' });
created.push(i);

console.log('\nSCRUM-187 events (open each at the link, as organiser@example.com unless the case says otherwise):');
for (const event of created) {
  console.log(`  ${event.reference}  ${event.key.padEnd(2)} http://localhost:3000/events/${event.id}`);
}
console.log('\nAccounts are the seed:users ones; colleague@example.com uses the same password (TestPass123!).');
console.log('colleague@example.com is in the same client organisation as organiser@example.com but owns no S187 event (TC-187-07).');
