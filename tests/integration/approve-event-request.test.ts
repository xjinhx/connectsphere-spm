import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { approveEventRequest } from '@/domain/review/service';

/**
 * SCRUM-92 — Approve a request so planning can proceed (US-7.3).
 *
 * AC text is from the Jira card, which is authoritative.
 *
 * Runs against the local Supabase stack (`npm run db:start` + `npm run db:reset`),
 * which is also what CI's "Migrations and integration tests" job does. A real
 * database is the point: the rule that only a SUBMITTED request can be approved
 * lives inside the UPDATE statement, so no test without Postgres can prove it.
 *
 * Not covered here - verify manually or in a later sprint:
 *   US-7.3-TC01, the "no venue, equipment or registration record is
 *        auto-created" half. Those tables do not exist this sprint, so the
 *        assertion can only pass trivially. Flag for re-execution once Venue
 *        Booking, Equipment and Attendee Registration land.
 *   AC1 end to end through the HTTP route - blocked on Authentication
 *        (getCurrentActor throws), which is why the approver's id is passed in.
 */

const supabase = createAdminClient();

// No foreign key on this column yet: Client Organisations is its own story.
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let coordinatorId: string;
const createdRequestIds: string[] = [];

async function createEventRequest(status: 'DRAFT' | 'SUBMITTED'): Promise<string> {
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

  if (status === 'SUBMITTED') {
    // Through the same path the app uses, so SCRUM-82's trigger stamps
    // submitted_at and the row satisfies its constraints.
    const { error: submitError } = await supabase
      .from('event_request')
      .update({ status: 'SUBMITTED' })
      .eq('id', id);
    if (submitError) throw new Error(`could not submit test request: ${submitError.message}`);
  }

  return id;
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
    const id = await createEventRequest('SUBMITTED');

    const outcome = await approveEventRequest(id, { actorId: coordinatorId });

    expect(outcome.status).toBe('APPROVED');
    expect(outcome.decision).toBe('APPROVED');
    expect(outcome.decidedBy).toBe(coordinatorId);
    expect(outcome.decidedAt).toBeTruthy();

    // And it is actually on the row, not just in the returned object.
    const row = await readRow(id);
    expect(row.status).toBe('APPROVED');
    expect(row.decision).toBe('APPROVED');
    expect(row.decided_by).toBe(coordinatorId);
    expect(row.decided_at).toBeTruthy();
    // AC1 changes the decision, not the submission: the request was still
    // submitted when it was, and that record survives approval.
    expect(row.submitted_at).toBeTruthy();
  });

  // Negative coverage: approving from an invalid starting status.
  it('refuses to approve a request that is already approved', async () => {
    const id = await createEventRequest('SUBMITTED');
    await approveEventRequest(id, { actorId: coordinatorId });

    await expect(approveEventRequest(id, { actorId: coordinatorId })).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });

  it('refuses to approve a draft, which has not been submitted for review', async () => {
    const id = await createEventRequest('DRAFT');

    await expect(approveEventRequest(id, { actorId: coordinatorId })).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });

    const row = await readRow(id);
    expect(row.status).toBe('DRAFT');
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
    const id = await createEventRequest('SUBMITTED');

    await expect(approveEventRequest(id, { actorId: 'coordinator-1' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    const row = await readRow(id);
    expect(row.status).toBe('SUBMITTED');
    expect(row.decision).toBeNull();
  });
});
