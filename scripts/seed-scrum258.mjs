// Local test-data setup for manually running SCRUM-142-TC18, TC19 and TC20
// (the SCRUM-258 bug: a five-digit year in a venue booking line's Date).
//
// Not part of any story: this only inserts Approved events assigned to
// coordinator@example.com, so the "Request a venue" form can be tried by hand.
// It does not submit any venue booking request - that is the manual step.
//
// A successful request moves its event to Planning, so each test that is meant
// to succeed gets an event of its own; a refused one leaves its event Approved,
// so the refusal tests can be repeated on the same event.
//
// Run: npm run db:start && npm run seed:users
//      then: node scripts/seed-scrum258.mjs
// Safe to run twice: an event whose name already exists is left alone.
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.');
}

// The service-role key bypasses every policy, so only ever run against the local stack.
if (!['127.0.0.1', 'localhost'].includes(new URL(SUPABASE_URL).hostname)) {
  throw new Error(`NEXT_PUBLIC_SUPABASE_URL (${SUPABASE_URL}) is not a local Supabase instance. Refusing to run.`);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';
const ORGANISATION_NAME = 'Integration Test Organisation';

const EVENTS = [
  { name: 'SCRUM-258 TC-142-18 valid date (succeeds)', use: 'TC-142-18: 31/12/2026, 09:00-12:00. Moves to Planning once submitted.' },
  { name: 'SCRUM-258 TC-142-19 five-digit year (form)', use: 'TC-142-19 steps 1-4: 10/12/20266 in the form. Stays Approved; repeatable.' },
  { name: 'SCRUM-258 TC-142-19 five-digit year (API)', use: 'TC-142-19 step 5: "date": "20266-12-10" sent to the API. Stays Approved; repeatable.' },
  { name: 'SCRUM-258 TC-142-20 Run A 31 Dec 9999', use: 'TC-142-20 Run A: 31/12/9999 is accepted. Moves to Planning once submitted.' },
  { name: 'SCRUM-258 TC-142-20 Run B 1 Jan 10000', use: 'TC-142-20 Run B: 01/01/10000 in the form, then "10000-01-01" to the API. Stays Approved; repeatable.' },
];

async function userId(email) {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) throw error;
  const id = data.users.find((user) => user.email === email)?.id;
  if (!id) throw new Error(`${email} does not exist. Run: npm run seed:users`);
  return id;
}

async function must(promise, what) {
  const { data, error } = await promise;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

const organiserId = await userId('organiser@example.com');
const coordinatorId = await userId('coordinator@example.com');

await must(
  admin.from('client_organisations').upsert({ id: ORGANISATION_ID, name: ORGANISATION_NAME }, { onConflict: 'id' }),
  'client organisation',
);

for (const { name, use } of EVENTS) {
  const existing = await must(admin.from('event_request').select('reference, status').eq('name', name), `look up "${name}"`);
  if (existing.length > 0) {
    console.log(`Already there: ${existing[0].reference} (${existing[0].status})  ${name}\n    ${use}`);
    continue;
  }

  const created = await must(
    admin
      .from('event_request')
      .insert({
        organiser_id: organiserId,
        client_organisation_id: ORGANISATION_ID,
        name,
        purpose: 'Manual test of SCRUM-258',
        expected_attendance: 50,
        start_time: '09:00',
        end_time: '12:00',
      })
      .select('id, reference')
      .single(),
    `create "${name}"`,
  );

  // The same steps the earlier stories would take: submit, assign, approve.
  await must(admin.from('event_request').update({ status: 'submitted' }).eq('id', created.id), 'submit');
  await must(
    admin.from('event_request').update({ coordinator_id: coordinatorId, assigned_by: coordinatorId }).eq('id', created.id),
    'assign',
  );
  await must(
    admin
      .from('event_request')
      .update({ status: 'approved', decision: 'approved', decided_by: coordinatorId })
      .eq('id', created.id),
    'approve',
  );

  console.log(`Created: ${created.reference} (approved, assigned to coordinator@example.com)  ${name}\n    ${use}`);
}

console.log('\nSign in as coordinator@example.com / TestPass123! and open each event from the coordinator\'s list.');
