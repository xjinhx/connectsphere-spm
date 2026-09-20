import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { approveEventRequest, getRejectionView, rejectEventRequest } from '@/domain/review/service';

/**
 * SCRUM-93 — Reject a request (US-7.3).
 *
 * AC text is from the Jira card, which is authoritative.
 *
 * Runs against the local Supabase stack (`npm run db:start` + `npm run db:reset`),
 * same reasoning as tests/integration/approve-event-request.test.ts: the rule
 * that only a submitted request can be rejected, and the reason/decision
 * constraints, live inside the database itself.
 *
 * Not covered here - see tests/unit/event-request-submit.test.ts:
 *   AC6's "cannot be edited or resubmitted" half - isEditable/canBeSubmitted
 *        already exclude 'rejected' with no new code, and there is nothing
 *        new to exercise against a database for it.
 * Not covered here - verify manually or via the API route:
 *   AC4 through the HTTP route - the middleware requires a signed-in session,
 *        so that path is covered by manual testing rather than here.
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

async function readRow(id: string) {
  const { data, error } = await supabase
    .from('event_request')
    .select('status, decision, decided_by, decided_at, rejection_reason, submitted_at')
    .eq('id', id)
    .single();
  if (error) throw new Error(`could not read test request: ${error.message}`);
  return data;
}

beforeAll(async () => {
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

describe('rejectEventRequest', () => {
  // US-7.7 93-TC05 (AC4)
  it('rejects a submitted request and records the reason, decision maker and timestamp', async () => {
    const id = await createEventRequest('submitted');

    const outcome = await rejectEventRequest(id, { reason: 'Venue capacity insufficient' }, coordinatorId);

    expect(outcome.status).toBe('rejected');
    expect(outcome.decision).toBe('rejected');
    expect(outcome.decidedBy).toBe(coordinatorId);
    expect(outcome.decidedAt).toBeTruthy();
    expect(outcome.rejectionReason).toBe('Venue capacity insufficient');

    // And it is actually on the row, not just in the returned object.
    const row = await readRow(id);
    expect(row.status).toBe('rejected');
    expect(row.decision).toBe('rejected');
    expect(row.decided_by).toBe(coordinatorId);
    expect(row.decided_at).toBeTruthy();
    expect(row.rejection_reason).toBe('Venue capacity insufficient');
    // AC4 changes the decision, not the submission: the request was still
    // submitted when it was, and that record survives rejection.
    expect(row.submitted_at).toBeTruthy();
  });

  // US-7.3-TC06 (AC5)
  it('refuses a rejection with a blank reason', async () => {
    const id = await createEventRequest('submitted');

    await expect(rejectEventRequest(id, { reason: '' }, coordinatorId)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    const row = await readRow(id);
    expect(row.status).toBe('submitted');
    expect(row.decision).toBeNull();
    expect(row.rejection_reason).toBeNull();
  });

  // AC5 says "without entering a reason" — whitespace is not an entry.
  it('refuses a rejection with a whitespace-only reason', async () => {
    const id = await createEventRequest('submitted');

    await expect(rejectEventRequest(id, { reason: '   ' }, coordinatorId)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    const row = await readRow(id);
    expect(row.status).toBe('submitted');
    expect(row.decision).toBeNull();
  });

  // Negative coverage: rejecting from an invalid starting status.
  it('refuses to reject a request that is already rejected', async () => {
    const id = await createEventRequest('submitted');
    await rejectEventRequest(id, { reason: 'Venue capacity insufficient' }, coordinatorId);

    await expect(
      rejectEventRequest(id, { reason: 'Second reason' }, coordinatorId),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('refuses to reject a draft, which has not been submitted for review', async () => {
    const id = await createEventRequest('draft');

    await expect(
      rejectEventRequest(id, { reason: 'Venue capacity insufficient' }, coordinatorId),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

    const row = await readRow(id);
    expect(row.status).toBe('draft');
    expect(row.decision).toBeNull();
  });

  // The two decisions must not be able to overwrite each other.
  it('refuses to reject a request that has already been approved', async () => {
    const id = await createEventRequest('submitted');
    await approveEventRequest(id, { actorId: coordinatorId });

    await expect(
      rejectEventRequest(id, { reason: 'Venue capacity insufficient' }, coordinatorId),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

    const row = await readRow(id);
    expect(row.status).toBe('approved');
    expect(row.decision).toBe('approved');
    expect(row.rejection_reason).toBeNull();
  });

  it('reports an unknown request as not found', async () => {
    await expect(
      rejectEventRequest(
        '99999999-9999-4999-8999-999999999999',
        { reason: 'Venue capacity insufficient' },
        coordinatorId,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // A bad link should not surface as a 500 from Postgres (22P02).
  it('reports a malformed id as not found rather than failing', async () => {
    await expect(
      rejectEventRequest('not-a-uuid', { reason: 'Venue capacity insufficient' }, coordinatorId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('getRejectionView', () => {
  // US-7.3-TC07 (AC6)
  it('shows the rejection reason and date once a request has been rejected', async () => {
    const id = await createEventRequest('submitted');
    await rejectEventRequest(id, { reason: 'Venue capacity insufficient' }, coordinatorId);

    const view = await getRejectionView(id);

    expect(view.status).toBe('rejected');
    expect(view.rejectionReason).toBe('Venue capacity insufficient');
    expect(view.decidedAt).toBeTruthy();
  });

  it('reports no rejection for a request that has not been decided', async () => {
    const id = await createEventRequest('submitted');

    const view = await getRejectionView(id);

    expect(view.rejectionReason).toBeNull();
    expect(view.decidedAt).toBeNull();
  });
});
