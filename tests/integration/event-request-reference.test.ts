import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { insertEventRequest } from '@/lib/supabase/eventRequests';
import { todayInSingapore } from '@/domain/shared/dates';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-76 AC2 — a saved event request is given a unique reference number.
 *
 * AC text is from the Jira card, which is authoritative.
 *
 * This is the AC the unit tests deliberately leave alone: the reference is a
 * column default built on a Postgres sequence (20260911000000_event_request.sql),
 * so nothing without a real database can show that it is generated at all, let
 * alone that it stays unique when two organisers save at the same instant.
 * Runs against the local Supabase stack (`pnpm run db:start` + `pnpm run db:reset`),
 * the same stack CI's migration job uses.
 *
 * Writes go through insertEventRequest() - the same helper the service layer
 * delegates to - rather than createEventRequest(), which resolves the actor
 * from a signed-in session. The generation rule under test lives in the table
 * default either way, and this keeps the test free of session plumbing.
 *
 * The admin client here arranges rows; that is test setup, not the code under
 * test, which never holds a client (docs/architecture.md).
 *
 * Not covered here - verify manually:
 *   The reference being shown back to the organiser after a save. That is the
 *        form and the confirmation screen, and belongs to the manual pass.
 *   AC1 (client organisation pre-filled) - blocked on SCRUM-204; this test
 *        writes a placeholder organisation id, same as the sibling tests.
 */

const supabase = createAdminClient();

// SCRUM-203's FK on client_organisation_id means this must be a real row, not
// just a placeholder uuid - ensureTestClientOrganisation() seeds it below.
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

/** EVT-<4-digit year>-<4-or-more-digit sequence>. */
const REFERENCE_PATTERN = /^EVT-\d{4}-\d{4,}$/;

let organiserId: string;
const createdRequestIds: string[] = [];

/** The fields SCRUM-76 collects; the rest of the write is siblings' columns. */
function basicDetails(name: string) {
  return {
    name,
    purpose: 'Networking',
    description: 'Yearly gathering',
    proposed_date: '2026-11-15',
    time_slots: null,
    start_time: null,
    end_time: null,
    room_layout: null,
    accessibility_required: null,
    accessibility_notes: null,
    preferred_location_id: null,
    equipment_required: null,
    technical_support_notes: null,
    registration_required: null,
    organiser_id: organiserId,
    client_organisation_id: CLIENT_ORGANISATION_ID,
  };
}

async function createRequest(name: string): Promise<{ id: string; reference: string }> {
  const { data, error } = await insertEventRequest(supabase, basicDetails(name));
  if (error || !data) {
    throw new Error(`could not create test request: ${error?.message ?? 'no row returned'}`);
  }
  const row = data as unknown as { id: string; reference: string };
  createdRequestIds.push(row.id);
  return row;
}

beforeAll(async () => {
  await ensureTestClientOrganisation(supabase);

  const { data, error } = await supabase.auth.admin.createUser({
    email: `organiser+${Date.now()}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`could not create test organiser: ${error?.message ?? 'no user returned'}`);
  }
  organiserId = data.user.id;
});

afterAll(async () => {
  // Requests first: organiser_id is ON DELETE RESTRICT, so the account cannot
  // go while one of their requests is still on the table.
  for (const id of createdRequestIds) {
    await supabase.from('event_request').delete().eq('id', id);
  }
  if (organiserId) await supabase.auth.admin.deleteUser(organiserId);
});

describe('SCRUM-76 AC2 — a saved request is given a unique reference', () => {
  it('stamps a reference on a request the caller never supplied one for', async () => {
    const { reference } = await createRequest('Annual Tech Summit');

    expect(reference).toMatch(REFERENCE_PATTERN);
  });

  it('reads the year in Singapore time, not the server’s (AC5)', async () => {
    // At 16:00-23:59 UTC on 31 December the two disagree, which is the window
    // this guards: a request saved at 08:00 on 1 January in Singapore must not
    // be stamped with the previous year.
    const { reference } = await createRequest('New Year Kickoff');

    expect(reference.split('-')[1]).toBe(todayInSingapore().slice(0, 4));
  });

  it('gives two requests saved one after the other different references', async () => {
    const first = await createRequest('Quarterly Review');
    const second = await createRequest('Quarterly Review');

    // Same name, same organiser, same day - the reference is what tells them apart.
    expect(first.reference).not.toBe(second.reference);
  });

  it('gives every request in a simultaneous batch its own reference', async () => {
    // The migration's claim: generating the reference in application code would
    // race, a sequence does not. Five concurrent inserts, five distinct values.
    const batch = await Promise.all(
      Array.from({ length: 5 }, (_, i) => createRequest(`Concurrent Save ${i}`)),
    );

    const references = batch.map((row) => row.reference);
    expect(new Set(references).size).toBe(references.length);
  });

  it('refuses a second row carrying a reference that is already taken', async () => {
    // The uniqueness half of AC2 is a database constraint, not a convention.
    // Without this, a future migration could drop `unique` and every other
    // test here would still pass.
    const { reference } = await createRequest('Board Meeting');

    const { error } = await supabase
      .from('event_request')
      .insert({ ...basicDetails('Board Meeting Duplicate'), reference });

    expect(error?.code).toBe('23505');
  });
});
