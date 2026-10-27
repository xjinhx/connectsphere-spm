// Seeds the manual run of SCRUM-76's test cases (TC-76-01 to TC-76-12; TC-76-10
// to TC-76-12 are the proposed date's year, the defect SCRUM-257). Only what
// those test cases need.
//
// Run: npm run db:start && npm run db:reset
//      node scripts/seed-scrum76.mjs          (no dev server needed; then npm run dev)
//
// Safe to run again: the account and organisation are updated in place, and every
// "S76" event is deleted and recreated.
//
// Accounts, all with password TestPass123!:
//   organiser@example.com ("Organiser"), linked to the client organisation
//     "S76 Test Organisation", so the New event request form opens with it
//     pre-filled (TC-76-02 to TC-76-08, TC-76-10 to TC-76-12).
//   organiser-unlinked@example.com ("Unlinked Organiser"), an Event Organiser
//     linked to no organisation (TC-76-09).
//   coordinator@example.com is the non-Organiser for TC-76-01 (npm run seed:users).
//
//   TC-76-10  New event request, Proposed date 10 Dec 2026, Save request.
//   TC-76-11  New event request, Proposed date year 20266, Save request, then Save as draft.
//             Also: open "S76 Draft to edit" and change its date to year 20266 -
//             resuming a draft saves through the same date rule.
//   TC-76-12  New event request, 31 Dec 9999 (saved), then 1 Jan 10000 (refused).
//
// "S76 Draft to edit" is a draft dated 10 Dec 2026, to resume from the list.
// Nothing else is seeded: each case creates its own request on the form. Name those
// requests starting "S76 " and running this script again clears them.
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_PASSWORD = 'TestPass123!';
const PREFIX = 'S76';
const ORGANISATION_NAME = 'S76 Test Organisation';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local before running this script.');
}

// Creates an account with a known password through the service-role key, so it
// refuses to run against anything but the local stack (same guard as
// scripts/seed-scrum232.mjs and seed-scrum249.mjs).
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

// --- The client organisation ---------------------------------------------------
const { data: organisation, error: organisationError } = await supabase
  .from('client_organisations')
  .upsert({ name: ORGANISATION_NAME }, { onConflict: 'name' })
  .select('id')
  .single();
if (organisationError) throw new Error(`organisation: ${organisationError.message}`);

// --- The organiser, linked to it ----------------------------------------------
const email = 'organiser@example.com';

/** Creates the account if missing, then sets its role, name and organisation (null = unlinked). */
async function ensureOrganiser(accountEmail, fullName, clientOrganisationId) {
  const { error: createError } = await supabase.auth.admin.createUser({
    email: accountEmail,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (createError && !createError.message.toLowerCase().includes('already been registered')) {
    throw new Error(`create ${accountEmail}: ${createError.message}`);
  }
  const id = await userIdByEmail(accountEmail);
  if (!id) throw new Error(`${accountEmail} not found after creating it.`);
  check(
    `profile ${accountEmail}`,
    await supabase
      .from('profiles')
      .update({ roles: ['event_organiser'], full_name: fullName, client_organisation_id: clientOrganisationId })
      .eq('id', id),
  );
  return id;
}

const organiserId = await ensureOrganiser(email, 'Organiser', organisation.id);
console.log(`Ready: ${email} (Event Organiser), linked to "${ORGANISATION_NAME}"`);
await ensureOrganiser('organiser-unlinked@example.com', 'Unlinked Organiser', null);
console.log('Ready: organiser-unlinked@example.com (Event Organiser), linked to no organisation');

// --- The draft to resume ------------------------------------------------------
check('clear S76 events', await supabase.from('event_request').delete().like('name', `${PREFIX} %`));

const draftName = `${PREFIX} Draft to edit`;
const { data: draft, error: draftError } = await supabase
  .from('event_request')
  .insert({
    name: draftName,
    purpose: 'Networking',
    description: 'Yearly gathering',
    proposed_date: '2026-12-10',
    organiser_id: organiserId,
    client_organisation_id: organisation.id,
  })
  .select('reference')
  .single();
if (draftError) throw new Error(`insert ${draftName}: ${draftError.message}`);
console.log(`Event:  ${draft.reference}  ${draftName}  draft, 10 Dec 2026`);

console.log(`
Done. Sign in as ${email} / ${TEST_PASSWORD} and open New event request.
Name the requests you create "${PREFIX} ..." and re-running this script clears them.`);
