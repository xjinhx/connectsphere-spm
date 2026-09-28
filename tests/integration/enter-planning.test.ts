import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { approveEventRequest, requestClarification, rejectEventRequest } from '@/domain/review/service';
import { enterPlanning } from '@/domain/event-status/service';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-101 AC3/AC4 — Move an event through its statuses (Approved -> Planning).
 *
 * AC text is from the Jira card, which is authoritative.
 *
 * Runs against the local Supabase stack (`npm run db:start` + `npm run
 * db:reset`), the same as tests/integration/approve-event-request.test.ts.
 * A real database is the point: AC3/AC4's "the status becomes Planning" /
 * "remains Planning" is a real row changing (or not changing), which no
 * unit test against fixture status values alone can prove — see
 * tests/unit/event-status-policy.test.ts for what a unit test does cover
 * (the transition *rule*, canEnterPlanning, in isolation).
 *
 * Not covered here: the real-world trigger (a venue or equipment request
 * being raised) — that is SCRUM-142/143's request-creation code calling
 * enterPlanning() once it exists, not this ticket's. This test calls
 * enterPlanning() directly, the same way approve-event-request.test.ts
 * calls approveEventRequest() directly rather than going through the HTTP
 * route.
 */

const supabase = createAdminClient();

const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let coordinatorId: string;
const createdRequestIds: string[] = [];

async function createEventRequest(
  status: 'draft' | 'submitted' | 'approved' | 'clarification_requested' | 'rejected',
): Promise<string> {
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

  if (status === 'draft') return id;

  const { error: submitError } = await supabase
    .from('event_request')
    .update({ status: 'submitted' })
    .eq('id', id);
  if (submitError) throw new Error(`could not submit test request: ${submitError.message}`);

  if (status === 'submitted') return id;

  if (status === 'clarification_requested') {
    // event_request_clarification_requested_has_note requires a note to be
    // set whenever status is clarification_requested, which only
    // requestClarification does correctly.
    await requestClarification(id, { note: 'What video-conferencing facilities are needed?' }, coordinatorId);
    return id;
  }

  if (status === 'rejected') {
    // event_request_rejection_reason_matches_decision requires a reason to
    // be set whenever decision is 'rejected', which only rejectEventRequest
    // does correctly.
    await rejectEventRequest(id, { reason: 'Budget for this event has not been confirmed.' }, coordinatorId);
    return id;
  }

  // Reaches 'approved' through the real service, not a raw status update:
  // event_request_decision_complete requires decision/decided_by/decided_at
  // to be set together, which only approveEventRequest does correctly.
  await approveEventRequest(id, { actorId: coordinatorId });

  return id;
}

async function readStatus(id: string): Promise<string> {
  const { data, error } = await supabase.from('event_request').select('status').eq('id', id).single();
  if (error) throw new Error(`could not read test request: ${error.message}`);
  return data.status as string;
}

beforeAll(async () => {
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
  for (const id of createdRequestIds) {
    await supabase.from('event_request').delete().eq('id', id);
  }
  if (coordinatorId) await supabase.auth.admin.deleteUser(coordinatorId);
});

describe('enterPlanning', () => {
  // AC3
  it('moves an approved event to planning', async () => {
    const id = await createEventRequest('approved');

    const outcome = await enterPlanning(id);

    expect(outcome.status).toBe('planning');

    // And it is actually on the row, not just in the returned object.
    expect(await readStatus(id)).toBe('planning');
  });

  // AC4 — idempotent, not refused as a duplicate transition.
  it('leaves an event already in planning unchanged, and succeeds', async () => {
    const id = await createEventRequest('approved');
    await enterPlanning(id);

    const outcome = await enterPlanning(id);

    expect(outcome.status).toBe('planning');
    expect(await readStatus(id)).toBe('planning');
  });

  // Negative coverage: entering planning from an invalid starting status.
  it('refuses a submitted event, which has not been approved yet', async () => {
    const id = await createEventRequest('submitted');

    await expect(enterPlanning(id)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

    expect(await readStatus(id)).toBe('submitted');
  });

  it('refuses a draft event', async () => {
    const id = await createEventRequest('draft');

    await expect(enterPlanning(id)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

    expect(await readStatus(id)).toBe('draft');
  });

  it('refuses an event awaiting clarification', async () => {
    const id = await createEventRequest('clarification_requested');

    await expect(enterPlanning(id)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

    expect(await readStatus(id)).toBe('clarification_requested');
  });

  it('refuses a rejected event', async () => {
    const id = await createEventRequest('rejected');

    await expect(enterPlanning(id)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

    expect(await readStatus(id)).toBe('rejected');
  });

  it('reports an unknown event as not found', async () => {
    await expect(enterPlanning('99999999-9999-4999-8999-999999999999')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('reports a malformed id as not found rather than failing', async () => {
    await expect(enterPlanning('not-a-uuid')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
