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
 * Who may view: the owner, the request's coordinator and Operations Managers
 * (canViewApproval). This read first took AC3's "anyone" as anyone signed in;
 * customer clarification #91 ties protected information to role and
 * relationship to the event, so everyone else is now refused - see the last
 * describe block. The tests above read as the owner.
 *
 * SCRUM-72 AC2 refuses an Attendee-only account before anything is read — see
 * the SCRUM-72 describe block and isAttendeeOnly's comment in
 * domain/identity/policy.ts.
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
/**
 * Someone with no part in any request made here. Only compared against the
 * request's owner and coordinator, never looked up, so it need not exist.
 */
const STRANGER = '44444444-4444-4444-8444-444444444444';

let coordinatorId: string;
/** The account that owns every request made here (organiser_id below). */
const owner = () => ({ userId: coordinatorId, roles: ['event_organiser'] as const });

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

    const view = await getApprovalView(id, owner());

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

    const view = await getApprovalView(id, owner());

    expect(view.status).toBe('approved');
    expect(view.status).not.toBe('confirmed');
    expect(view.commitments.venue).toBe(false);
    expect(view.commitments.equipment).toBe(false);
  });

  // SCRUM-235: the statement belongs only to an event that is still Approved.
  // Asserted on the view itself, which the API route returns as-is, so the
  // page and the API cannot disagree again.
  it.each(['planning', 'confirmed', 'completed'] as const)(
    'keeps the outcome and date but drops the statement once the event is %s',
    async (status) => {
      const id = await createSubmittedRequest();
      const outcome = await approveEventRequest(id, { actorId: coordinatorId });
      const { error } = await supabase.from('event_request').update({ status }).eq('id', id);
      if (error) throw new Error(`could not move test request to ${status}: ${error.message}`);

      const view = await getApprovalView(id, owner());

      expect(view.status).toBe(status);
      expect(view.decision).toBe('approved');
      expect(view.decidedAt).toBe(outcome.decidedAt);
      expect(view.commitmentStatement).toBeNull();
    },
  );

  it('shows no outcome or date for a request that has not been decided yet', async () => {
    const id = await createSubmittedRequest();

    const view = await getApprovalView(id, owner());

    expect(view.status).toBe('submitted');
    expect(view.decision).toBeNull();
    expect(view.decidedAt).toBeNull();
  });

  it('does not reveal who made the decision', async () => {
    const id = await createSubmittedRequest();
    await approveEventRequest(id, { actorId: coordinatorId });

    const view = await getApprovalView(id, owner());

    expect(view).not.toHaveProperty('decidedBy');
  });

  it('reports an unknown request as not found', async () => {
    await expect(
      getApprovalView('99999999-9999-4999-8999-999999999999', owner()),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('reports a malformed id as not found rather than failing', async () => {
    await expect(getApprovalView('not-a-uuid', owner())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// ---------------------------------------------------------------------------
// SCRUM-72 AC2 — an Attendee-only account may not read this by requesting it
// directly, narrowing SCRUM-92 AC3's "anyone" per customer clarification #91.
// ---------------------------------------------------------------------------
describe('getApprovalView: SCRUM-72 AC2', () => {
  it('refuses an Attendee-only account and returns no planning data', async () => {
    const id = await createSubmittedRequest();
    await approveEventRequest(id, { actorId: coordinatorId });

    await expect(getApprovalView(id, { userId: STRANGER, roles: ['attendee'] })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('still allows an account holding both Attendee and a planning role', async () => {
    const id = await createSubmittedRequest();
    await approveEventRequest(id, { actorId: coordinatorId });

    const view = await getApprovalView(id, { userId: STRANGER, roles: ['attendee', 'coordinator'] });
    expect(view.decision).toBe('approved');
  });
});

// ---------------------------------------------------------------------------
// Customer clarification #91 — access follows "role and relationship to the
// event". This read used to answer anyone signed in; now only the owner, the
// request's coordinator and Operations Managers get an answer.
// ---------------------------------------------------------------------------
describe('getApprovalView: only people with a part in the request', () => {
  // The bug as reported: an organiser holding the id of someone else's request.
  it('refuses an organiser who does not own the request', async () => {
    const id = await createSubmittedRequest();
    await approveEventRequest(id, { actorId: coordinatorId });

    await expect(
      getApprovalView(id, { userId: STRANGER, roles: ['event_organiser'] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses a coordinator the request is assigned away from', async () => {
    const id = await createSubmittedRequest();
    const { error } = await supabase
      .from('event_request')
      .update({ coordinator_id: coordinatorId, assigned_by: coordinatorId })
      .eq('id', id);
    if (error) throw new Error(`could not assign test request: ${error.message}`);

    await expect(
      getApprovalView(id, { userId: STRANGER, roles: ['coordinator'] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows any coordinator while the request has no coordinator yet', async () => {
    const id = await createSubmittedRequest();

    const view = await getApprovalView(id, { userId: STRANGER, roles: ['coordinator'] });
    expect(view.status).toBe('submitted');
  });

  it('allows an Event Operations Manager', async () => {
    const id = await createSubmittedRequest();
    await approveEventRequest(id, { actorId: coordinatorId });

    const view = await getApprovalView(id, { userId: STRANGER, roles: ['operations_manager'] });
    expect(view.decision).toBe('approved');
  });
});
