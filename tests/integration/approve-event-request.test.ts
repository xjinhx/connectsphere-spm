import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { approveEventRequest } from '@/domain/review/service';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-92 — Approve a request so planning can proceed (US-7.3).
 *
 * AC text is from the Jira card, which is authoritative.
 *
 * Runs against the local Supabase stack (`npm run db:start` + `npm run db:reset`),
 * which is also what CI's "Migrations and integration tests" job does. A real
 * database is the point: the rule that only a submitted request can be approved
 * lives inside the UPDATE statement, so no test without Postgres can prove it.
 *
 * The test itself uses the admin client to arrange rows - that is test setup,
 * not the code under test, which never holds a client (docs/architecture.md).
 *
 * Not covered here - verify manually or in a later sprint:
 *   US-7.3-TC01, the "no venue, equipment or registration record is
 *        auto-created" half. Those tables do not exist this sprint, so the
 *        assertion can only pass trivially. Flag for re-execution once Venue
 *        Booking, Equipment and Attendee Registration land.
 *   AC1 through the HTTP route - the middleware requires a signed-in session,
 *        so that path is covered by the manual test rather than here.
 */

const supabase = createAdminClient();

// No foreign key on this column yet: Client Organisations is its own story.
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let coordinatorId: string;
const createdRequestIds: string[] = [];

async function createEventRequest(status: 'draft' | 'submitted'): Promise<string> {
  const { data, error } = await supabase
    .from('event_request')
    .insert({
      organiser_id: coordinatorId,
      client_organisation_id: CLIENT_ORGANISATION_ID,
      name: 'Annual Tech Summit',
    })
    .select('id')
    .single();
  if (error) throw new Error(`could not create test request: ${error.message}`);

  const id = data.id as string;
  createdRequestIds.push(id);

  if (status === 'submitted') {
    // Through the same path the app uses, so SCRUM-82's trigger stamps
    // submitted_at and the row satisfies its constraints.
    const { error: submitError } = await supabase
      .from('event_request')
      .update({ status: 'submitted' })
      .eq('id', id);
    if (submitError) throw new Error(`could not submit test request: ${submitError.message}`);
  }

  return id;
}

/**
 * SCRUM-232 AC5: assignment through the Lead's queue is now a precondition
 * of approving, so every test that approves a request must assign it first.
 */
async function assignTo(id: string, assignee: string): Promise<void> {
  const { error } = await supabase
    .from('event_request')
    .update({ coordinator_id: assignee, assigned_by: assignee })
    .eq('id', id);
  if (error) throw new Error(`could not assign test request: ${error.message}`);
}

async function readRow(id: string) {
  const { data, error } = await supabase
    .from('event_request')
    .select('status, decision, decided_by, decided_at, submitted_at')
    .eq('id', id)
    .single();
  if (error) throw new Error(`could not read test request: ${error.message}`);
  return data;
}

beforeAll(async () => {
  // SCRUM-203's FK on client_organisation_id means CLIENT_ORGANISATION_ID
  // below must be a real row, not just a placeholder uuid.
  await ensureTestClientOrganisation(supabase);

  const { data, error } = await supabase.auth.admin.createUser({
    email: `coordinator+${Date.now()}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`could not create test coordinator: ${error?.message ?? 'no user returned'}`);
  }
  coordinatorId = data.user.id;
});

afterAll(async () => {
  // Requests first: decided_by is ON DELETE RESTRICT, so the account cannot go
  // while a decision of theirs is still recorded.
  for (const id of createdRequestIds) {
    await supabase.from('event_request').delete().eq('id', id);
  }
  if (coordinatorId) await supabase.auth.admin.deleteUser(coordinatorId);
});

describe('approveEventRequest', () => {
  // US-7.3-TC01 (AC1)
  it('approves a submitted request and records the decision, decision maker and timestamp', async () => {
    const id = await createEventRequest('submitted');
    await assignTo(id, coordinatorId);

    const outcome = await approveEventRequest(id, { actorId: coordinatorId });

    expect(outcome.status).toBe('approved');
    expect(outcome.decision).toBe('approved');
    expect(outcome.decidedBy).toBe(coordinatorId);
    expect(outcome.decidedAt).toBeTruthy();

    // And it is actually on the row, not just in the returned object.
    const row = await readRow(id);
    expect(row.status).toBe('approved');
    expect(row.decision).toBe('approved');
    expect(row.decided_by).toBe(coordinatorId);
    expect(row.decided_at).toBeTruthy();
    // AC1 changes the decision, not the submission: the request was still
    // submitted when it was, and that record survives approval.
    expect(row.submitted_at).toBeTruthy();
  });

  // Negative coverage: approving from an invalid starting status.
  it('refuses to approve a request that is already approved', async () => {
    const id = await createEventRequest('submitted');
    await assignTo(id, coordinatorId);
    await approveEventRequest(id, { actorId: coordinatorId });

    await expect(approveEventRequest(id, { actorId: coordinatorId })).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });

  // SCRUM-232 AC5: a draft carries no coordinator_id - the database refuses
  // to assign one to a draft at all (event_request_assignment_needs_submission),
  // so this stays the unassigned case. canReviewDetail now refuses it before
  // canBeApproved is ever reached.
  it('refuses to approve a draft, which has not been submitted for review', async () => {
    const id = await createEventRequest('draft');

    await expect(approveEventRequest(id, { actorId: coordinatorId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const row = await readRow(id);
    expect(row.status).toBe('draft');
    expect(row.decision).toBeNull();
  });

  it('reports an unknown request as not found', async () => {
    await expect(
      approveEventRequest('99999999-9999-4999-8999-999999999999', { actorId: coordinatorId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // A bad link should not surface as a 500 from Postgres (22P02).
  it('reports a malformed id as not found rather than failing', async () => {
    await expect(
      approveEventRequest('not-a-uuid', { actorId: coordinatorId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses an approval with no valid approver', async () => {
    const id = await createEventRequest('submitted');

    await expect(approveEventRequest(id, { actorId: 'coordinator-1' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    const row = await readRow(id);
    expect(row.status).toBe('submitted');
    expect(row.decision).toBeNull();
  });
});
