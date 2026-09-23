import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { approveEventRequest, getApprovalView } from '@/domain/review/service';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-92 — Approve a request so planning can proceed (US-7.3), AC2 and AC3.
 *
 * AC text is from the Jira card, which is authoritative:
 *   AC2 — "Given a request has been approved, when the Event Organiser views it,
 *          then the approval outcome and date are shown together with a
 *          statement that no venue, equipment or registration arrangement is
 *          yet committed."
 *   AC3 — "Given a request has only been approved, when anyone views the event,
 *          then its status is not Confirmed and no venue or equipment is shown
 *          as committed."
 *
 * Who may view: Jira AC3 says "anyone", so getApprovalView applies no ownership
 * or role check; the middleware refuses the route without a signed-in session.
 * The test sheet's TC06 wording ("any authorised user") is drift from Jira.
 *
 * Runs against the local Supabase stack, like approve-event-request.test.ts.
 * The admin client below only arranges rows; the code under test never holds
 * a client (docs/architecture.md).
 *
 * Flag for re-execution in a later sprint:
 *   US-7.3-TC06, and the commitment half of US-7.3-TC05, pass trivially: there
 *   is no Confirmed status and no venue, equipment or registration record that
 *   could be committed. Re-run once Event Status Management, Venue Booking,
 *   Equipment and Attendee Registration exist.
 */

const supabase = createAdminClient();
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let coordinatorId: string;
const createdRequestIds: string[] = [];

async function createSubmittedRequest(): Promise<string> {
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

  const { error: submitError } = await supabase
    .from('event_request')
    .update({ status: 'submitted' })
    .eq('id', id);
  if (submitError) throw new Error(`could not submit test request: ${submitError.message}`);

  return id;
}

beforeAll(async () => {
  // SCRUM-203's FK on client_organisation_id means CLIENT_ORGANISATION_ID
  // below must be a real row, not just a placeholder uuid.
  await ensureTestClientOrganisation(supabase);

  const { data, error } = await supabase.auth.admin.createUser({
    email: `coordinator+view${Date.now()}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`could not create test coordinator: ${error?.message ?? 'no user returned'}`);
  }
  coordinatorId = data.user.id;
});

afterAll(async () => {
  // Requests first: decided_by is ON DELETE RESTRICT.
  for (const id of createdRequestIds) {
    await supabase.from('event_request').delete().eq('id', id);
  }
  if (coordinatorId) await supabase.auth.admin.deleteUser(coordinatorId);
});

describe('getApprovalView', () => {
  // US-7.3-TC05 (AC2)
  it('shows the approval outcome and date together with the no-commitment statement', async () => {
    const id = await createSubmittedRequest();
    const outcome = await approveEventRequest(id, { actorId: coordinatorId });

    const view = await getApprovalView(id);

    expect(view.decision).toBe('approved');
    // The date shown is the one recorded at approval, not a new one.
    expect(view.decidedAt).toBe(outcome.decidedAt);
    expect(view.commitmentStatement).toBe(
      'No venue, equipment or registration arrangement is yet committed.',
    );
    expect(view.commitments).toEqual({ venue: false, equipment: false, registration: false });
  });

  // US-7.3-TC06 (AC3)
  it('shows an approved request as approved, not confirmed, with no venue or equipment committed', async () => {
    const id = await createSubmittedRequest();
    await approveEventRequest(id, { actorId: coordinatorId });

    const view = await getApprovalView(id);

    expect(view.status).toBe('approved');
    expect(view.status).not.toBe('confirmed');
    expect(view.commitments.venue).toBe(false);
    expect(view.commitments.equipment).toBe(false);
  });

  it('shows no outcome or date for a request that has not been decided yet', async () => {
    const id = await createSubmittedRequest();

    const view = await getApprovalView(id);

    expect(view.status).toBe('submitted');
    expect(view.decision).toBeNull();
    expect(view.decidedAt).toBeNull();
  });

  it('does not reveal who made the decision', async () => {
    const id = await createSubmittedRequest();
    await approveEventRequest(id, { actorId: coordinatorId });

    const view = await getApprovalView(id);

    expect(view).not.toHaveProperty('decidedBy');
  });

  it('reports an unknown request as not found', async () => {
    await expect(getApprovalView('99999999-9999-4999-8999-999999999999')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('reports a malformed id as not found rather than failing', async () => {
    await expect(getApprovalView('not-a-uuid')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
