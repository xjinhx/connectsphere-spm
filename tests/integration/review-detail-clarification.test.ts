import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  approveEventRequest,
  getClarificationView,
  getReviewDetail,
  requestClarification,
} from '@/domain/review/service';
import { isAwaitingReview } from '@/domain/review/policy';
import {
  markEventRequestClarificationRequested,
  markEventRequestSubmitted,
} from '@/lib/supabase/eventRequests';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-89 / SCRUM-90 — US-7.1 AC2 and US-7.2 AC1/AC3, from
 * `ConnectSphere_Test_Cases_v3.xlsx` ("User Stories & ACs" / "Test Cases"):
 *   US-7.1-TC02 — "Open the request from the queue" -> all submitted fields,
 *        including venue, equipment and registration requirements, are visible.
 *        (The attachments clause of that TC is not covered: no attachment
 *        feature exists in this codebase, and none is in the current sprint's
 *        scope; the review page says so rather than omitting the row.)
 *   US-7.1-TC03 — a request that has been clarified no longer counts as
 *        awaiting review.
 *   US-7.2-TC01 — a clarification message is saved with the event and is
 *        visible to the Organiser.
 *   US-7.2-TC03 — the clarification is shown to any authorised viewer; the
 *        *response* half needs SCRUM-91, which is not built.
 *
 * What only a real database can prove, and why this file exists: the note,
 * requester and timestamp actually landing on the row, the
 * set_clarification_requested_at trigger stamping the time, and the
 * `.eq('status','submitted')` filter that decides two coordinators racing.
 *
 * Runs against the local Supabase stack (`pnpm run db:start` + `db:reset`),
 * like approve-event-request.test.ts. The admin client below only arranges
 * rows; the code under test never holds a client (docs/architecture.md).
 */

const supabase = createAdminClient();
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let coordinatorId: string;
/** SCRUM-89 AC3's "another Event Coordinator". */
let otherCoordinatorId: string;
/** A third account, for "assigned to somebody who is not either of us". */
let unrelatedCoordinatorId: string;
const createdRequestIds: string[] = [];

/**
 * createRequest below puts every request under `coordinatorId` as its
 * organiser, so this is the account that owns them.
 */
const asOwningOrganiser = () => ({ userId: coordinatorId, roles: ['event_organiser'] as const });
const asCoordinator = (userId: string) => ({ userId, roles: ['coordinator'] as const });

/** The stored row, for assertions about what a refused call did not change. */
async function readRow(id: string): Promise<{ status: string; clarification_note: string | null }> {
  const { data, error } = await supabase
    .from('event_request')
    .select('status, clarification_note')
    .eq('id', id)
    .single();
  if (error) throw new Error(`could not read test request: ${error.message}`);
  return data as { status: string; clarification_note: string | null };
}

/**
 * Assignment goes through an update, not the insert: assigned_at is stamped by
 * the set_assigned_at trigger on update only, and
 * event_request_assignment_complete requires the three columns together.
 */
async function assignTo(id: string, assignee: string): Promise<void> {
  const { error } = await supabase
    .from('event_request')
    .update({ coordinator_id: assignee, assigned_by: assignee })
    .eq('id', id);
  if (error) throw new Error(`could not assign test request: ${error.message}`);
}

async function createRequest(
  status: 'draft' | 'submitted',
  values: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await supabase
    .from('event_request')
    .insert({
      organiser_id: coordinatorId,
      client_organisation_id: CLIENT_ORGANISATION_ID,
      name: 'Annual Tech Summit',
      ...values,
    })
    .select('id')
    .single();
  if (error) throw new Error(`could not create test request: ${error.message}`);

  const id = data.id as string;
  createdRequestIds.push(id);

  if (status === 'submitted') {
    const { error: submitError } = await supabase
      .from('event_request')
      .update({ status: 'submitted' })
      .eq('id', id);
    if (submitError) throw new Error(`could not submit test request: ${submitError.message}`);
  }

  return id;
}

beforeAll(async () => {
  // SCRUM-203's FK on client_organisation_id means CLIENT_ORGANISATION_ID
  // below must be a real row, not just a placeholder uuid.
  await ensureTestClientOrganisation(supabase);

  const { data, error } = await supabase.auth.admin.createUser({
    email: `coordinator+clarify${Date.now()}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`could not create test coordinator: ${error?.message ?? 'no user returned'}`);
  }
  coordinatorId = data.user.id;

  const { data: other, error: otherError } = await supabase.auth.admin.createUser({
    email: `coordinator+other${Date.now()}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (otherError || !other.user) {
    throw new Error(
      `could not create second test coordinator: ${otherError?.message ?? 'no user returned'}`,
    );
  }
  otherCoordinatorId = other.user.id;

  const { data: third, error: thirdError } = await supabase.auth.admin.createUser({
    email: `coordinator+unrelated${Date.now()}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (thirdError || !third.user) {
    throw new Error(
      `could not create third test coordinator: ${thirdError?.message ?? 'no user returned'}`,
    );
  }
  unrelatedCoordinatorId = third.user.id;
});

afterAll(async () => {
  // Requests first: clarification_requested_by is ON DELETE RESTRICT.
  for (const id of createdRequestIds) {
    await supabase.from('event_request').delete().eq('id', id);
  }
  if (coordinatorId) await supabase.auth.admin.deleteUser(coordinatorId);
  // Also ON DELETE RESTRICT via coordinator_id/assigned_by, so this must
  // follow the requests above.
  if (otherCoordinatorId) await supabase.auth.admin.deleteUser(otherCoordinatorId);
  if (unrelatedCoordinatorId) await supabase.auth.admin.deleteUser(unrelatedCoordinatorId);
});

describe('getReviewDetail', () => {
  // US-7.1-TC02 (AC2)
  it('shows every field the Organiser submitted', async () => {
    const id = await createRequest('submitted', {
      purpose: 'Client launch',
      description: 'A full-day summit',
      proposed_date: '2026-11-20',
      expected_attendance: 120,
      room_layout: 'theatre',
      accessibility_required: true,
      accessibility_notes: 'Step-free access to the stage',
      equipment_required: true,
      technical_support_notes: 'AV technician for the keynote',
      registration_required: true,
    });
    // SCRUM-232 AC5: assignment is now a precondition of review, so this
    // field-mapping test needs a real assignment to reach getReviewDetail at all.
    await assignTo(id, coordinatorId);

    const detail = await getReviewDetail(id, coordinatorId);

    expect(detail.purpose).toBe('Client launch');
    expect(detail.description).toBe('A full-day summit');
    expect(detail.proposedDate).toBe('2026-11-20');
    expect(detail.expectedAttendance).toBe(120);
    expect(detail.roomLayout).toBe('theatre');
    expect(detail.accessibilityRequired).toBe(true);
    expect(detail.accessibilityNotes).toBe('Step-free access to the stage');
    expect(detail.equipmentRequired).toBe(true);
    expect(detail.technicalSupportNotes).toBe('AV technician for the keynote');
    expect(detail.registrationRequired).toBe(true);
  });

  // AC2's "a blank section is shown as not provided, not omitted" — the key is
  // present and null, so the page can say "Not provided" rather than silently
  // dropping the row.
  it('carries an unanswered field as null rather than dropping the key', async () => {
    const id = await createRequest('submitted');
    await assignTo(id, coordinatorId);

    const detail = await getReviewDetail(id, coordinatorId);

    expect(detail).toHaveProperty('purpose', null);
    expect(detail).toHaveProperty('roomLayout', null);
    expect(detail).toHaveProperty('registrationRequired', null);
    expect(detail).toHaveProperty('clarificationNote', null);
  });

  it('reports an unknown request as not found', async () => {
    await expect(
      getReviewDetail('99999999-9999-4999-8999-999999999999', coordinatorId),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  // US-7.1-TC03 (AC3) — "Given a submitted request is assigned to another
  // Event Coordinator, when I request it directly by its identifier, then
  // access is denied and no request data is returned."
  it('denies a request assigned to another coordinator, returning no data', async () => {
    const id = await createRequest('submitted', { purpose: 'Client launch' });
    await assignTo(id, otherCoordinatorId);

    await expect(getReviewDetail(id, coordinatorId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows the coordinator the request is actually assigned to', async () => {
    const id = await createRequest('submitted', { purpose: 'Client launch' });
    await assignTo(id, coordinatorId);

    const detail = await getReviewDetail(id, coordinatorId);

    expect(detail.purpose).toBe('Client launch');
    expect(detail.canManage).toBe(true);
  });

  // SCRUM-232 AC5 (Week 7 Change 5): assignment through the Event Coordinator
  // Lead's queue is now a precondition of review - an unassigned request is
  // no longer open to any Coordinator directly.
  it('refuses any coordinator while the request has no coordinator yet', async () => {
    const id = await createRequest('submitted', { purpose: 'Client launch' });

    await expect(getReviewDetail(id, coordinatorId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  // The Lead still gets a read-only way in, whether the request is assigned
  // or not - "review basic event information" (Change 5). canManage is false:
  // the page uses it to withhold the decision forms from a Lead who is not
  // also the assigned coordinator.
  it('allows the Event Coordinator Lead to view any request, read-only', async () => {
    const id = await createRequest('submitted', { purpose: 'Client launch' });

    const detail = await getReviewDetail(id, otherCoordinatorId, ['operations_manager']);

    expect(detail.purpose).toBe('Client launch');
    expect(detail.canManage).toBe(false);
  });

  it('still reports canManage: false for the Lead on an assigned request they do not hold', async () => {
    const id = await createRequest('submitted', { purpose: 'Client launch' });
    await assignTo(id, coordinatorId);

    const detail = await getReviewDetail(id, otherCoordinatorId, ['operations_manager']);

    expect(detail.canManage).toBe(false);
  });

  // A draft is the Organiser's private working copy and carries no
  // coordinator_id, so the assignment rule alone read it as "unassigned,
  // open to any Coordinator" - which let any Coordinator open any Organiser's
  // unsubmitted draft through this route. Not found rather than forbidden: a
  // Coordinator has no business learning the id exists.
  it('treats an organiser\'s draft as not found, not as an unassigned request', async () => {
    const id = await createRequest('draft', { purpose: 'Still being written' });

    await expect(getReviewDetail(id, coordinatorId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('reports a malformed id as not found rather than failing', async () => {
    await expect(getReviewDetail('not-a-uuid', coordinatorId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('requestClarification', () => {
  // US-7.2-TC01 (AC1)
  it('saves the note with the event and moves it to Clarification Requested', async () => {
    const id = await createRequest('submitted');
    // SCRUM-232 AC5: assignment is now a precondition of raising a
    // clarification too, same as approving and rejecting.
    await assignTo(id, coordinatorId);

    const outcome = await requestClarification(
      id,
      { note: 'Please confirm the expected AV setup' },
      coordinatorId,
    );

    expect(outcome.status).toBe('clarification_requested');
    expect(outcome.clarificationNote).toBe('Please confirm the expected AV setup');
    expect(outcome.clarificationRequestedBy).toBe(coordinatorId);
    // Stamped by set_clarification_requested_at, not by the caller.
    expect(outcome.clarificationRequestedAt).not.toBeNull();
  });

  // SCRUM-90 AC3 — a blank note is refused before anything is written.
  it('refuses a whitespace-only note the same as an empty one', async () => {
    const id = await createRequest('submitted');
    await assignTo(id, coordinatorId);

    await expect(requestClarification(id, { note: '   ' }, coordinatorId)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    const detail = await getReviewDetail(id, coordinatorId);
    expect(detail.status).toBe('submitted');
    expect(detail.clarificationNote).toBeNull();
  });

  // SCRUM-232 AC5 (Week 7 Change 5): assignment through the Lead's queue is
  // now a precondition of raising a clarification, not just reading one.
  it('refuses any coordinator to raise a clarification on an event with no coordinator yet', async () => {
    const id = await createRequest('submitted');

    await expect(
      requestClarification(id, { note: 'Please confirm the expected AV setup' }, coordinatorId),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const row = await readRow(id);
    expect(row.status).toBe('submitted');
    expect(row.clarification_note).toBeNull();
  });

  // Was INVALID_TRANSITION until the draft leak was fixed: a draft carries no
  // coordinator_id, so the assignment rule passed it and the status rule then
  // answered "cannot move from draft", which confirms the draft exists just as
  // plainly as returning it would. Not found is the honest answer to a
  // Coordinator who should not know the id is real.
  it('reports a draft as not found rather than naming its status', async () => {
    const id = await createRequest('draft');

    await expect(
      requestClarification(id, { note: 'Anything' }, coordinatorId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // The `.eq('status','submitted')` filter is what makes this safe; a second
  // note before the Organiser has replied does not overwrite the first.
  it('refuses a second clarification while one is already outstanding', async () => {
    const id = await createRequest('submitted');
    await assignTo(id, coordinatorId);
    await requestClarification(id, { note: 'First question' }, coordinatorId);

    await expect(
      requestClarification(id, { note: 'Second question' }, coordinatorId),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

    const detail = await getReviewDetail(id, coordinatorId);
    expect(detail.clarificationNote).toBe('First question');
  });

  // US-7.1-TC03 (AC3) — once clarified, it is no longer awaiting review.
  // SCRUM-96 AC4, reported by that story's owner against merged code: the
  // route's role check passes for every Coordinator, so without a per-event
  // rule a Coordinator reassigned away could still move someone else's event
  // to Clarification Requested and message its Organiser.
  it('refuses a coordinator the request is assigned away from, leaving the status alone', async () => {
    const id = await createRequest('submitted');
    await assignTo(id, otherCoordinatorId);

    await expect(
      requestClarification(id, { note: 'Please confirm attendance.' }, unrelatedCoordinatorId),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const row = await readRow(id);
    expect(row.status).toBe('submitted');
    expect(row.clarification_note).toBeNull();
  });

  it('allows the coordinator the request is actually assigned to', async () => {
    const id = await createRequest('submitted');
    await assignTo(id, otherCoordinatorId);

    const outcome = await requestClarification(
      id,
      { note: 'Please confirm attendance.' },
      otherCoordinatorId,
    );

    expect(outcome.status).toBe('clarification_requested');
    expect(outcome.clarificationRequestedBy).toBe(otherCoordinatorId);
  });

  // The per-event check above is a read; this is the write refusing the same
  // thing, so a reassignment landing between the two cannot be written over.
  // Exercised at the database function directly: the service's own check
  // would refuse first, so this is the only way to reach the filter.
  it('refuses when the request is reassigned between the check and the write', async () => {
    const id = await createRequest('submitted');
    await assignTo(id, otherCoordinatorId);

    // The row is assigned to `other`; the write is attempted as `unrelated`.
    // The UPDATE's own coordinator filter misses, which is the state the
    // service turns into a denial.
    const { data } = await markEventRequestClarificationRequested(
      id,
      'Please confirm attendance.',
      unrelatedCoordinatorId,
    );

    expect(data).toBeNull();
    expect((await readRow(id)).status).toBe('submitted');
  });

  // The allowing half of the same filter: a row assigned to the actor is
  // written. Without it, a filter that only matched unassigned rows would pass
  // the refusal test above while refusing every assigned Coordinator. This
  // does not stage a reassignment between the check and the write - it asks
  // whether the actor may act on the row now, which is all the filter does.
  it('allows the write when the request is assigned to the actor', async () => {
    const id = await createRequest('submitted');
    await assignTo(id, otherCoordinatorId);

    const { data } = await markEventRequestClarificationRequested(
      id,
      'Please confirm attendance.',
      otherCoordinatorId,
    );

    expect(data).not.toBeNull();
    expect((await readRow(id)).status).toBe('clarification_requested');
  });

  // SCRUM-232 AC5: no `is.null` branch in the filter any more - an event
  // with no coordinator yet can no longer be clarified by anyone.
  it('writes nothing when the event has no coordinator yet', async () => {
    const id = await createRequest('submitted');

    const { data } = await markEventRequestClarificationRequested(
      id,
      'Please confirm attendance.',
      coordinatorId,
    );

    expect(data).toBeNull();
    expect((await readRow(id)).status).toBe('submitted');
  });

  // SCRUM-96 AC4 — "access is denied and no planning information is
  // returned". A Coordinator reassigned away must get the same 403 whatever
  // the event's status is now. With the status check first they got a 409
  // naming it ("cannot move from approved"), learning the event was approved.
  // Raised in review of PR #57.
  it('refuses a reassigned-away coordinator without revealing the status', async () => {
    const id = await createRequest('submitted');
    await assignTo(id, unrelatedCoordinatorId);
    await assignTo(id, otherCoordinatorId);
    await approveEventRequest(id, { actorId: otherCoordinatorId });

    await expect(
      requestClarification(id, { note: 'Please confirm attendance.' }, unrelatedCoordinatorId),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'This event request is not assigned to you.',
    });
    expect((await readRow(id)).status).toBe('approved');
  });

  it('takes the request out of the awaiting-review queue', async () => {
    const id = await createRequest('submitted');
    await assignTo(id, coordinatorId);
    expect(isAwaitingReview((await getReviewDetail(id, coordinatorId)).status)).toBe(true);

    await requestClarification(id, { note: 'Please confirm the venue' }, coordinatorId);

    expect(isAwaitingReview((await getReviewDetail(id, coordinatorId)).status)).toBe(false);
  });
});

/**
 * US-7.2's round trip — "so that I can get what I need without leaving the
 * system". SCRUM-90 AC2 makes a clarified request editable again; this is the
 * other half, that it can then be sent back.
 *
 * `submitEventRequest()` itself reads the signed-in session, so it cannot be
 * driven from here; this exercises the database filter underneath it, which is
 * what actually refused the resubmission before
 * (markEventRequestSubmitted matched no row for a clarification_requested one).
 */
describe('resubmitting after a clarification', () => {
  it('accepts a clarification_requested request back into submitted', async () => {
    const id = await createRequest('submitted');
    await assignTo(id, coordinatorId);
    await requestClarification(id, { note: 'Please confirm the venue' }, coordinatorId);

    const { data, error } = await markEventRequestSubmitted(supabase, id);

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect((data as unknown as { status: string }).status).toBe('submitted');
  });

  it('keeps the original submission time, so it holds its place in the queue', async () => {
    const id = await createRequest('submitted');
    await assignTo(id, coordinatorId);
    const before = (await getReviewDetail(id, coordinatorId)).submittedAt;
    await requestClarification(id, { note: 'Please confirm the venue' }, coordinatorId);

    await markEventRequestSubmitted(supabase, id);

    expect((await getReviewDetail(id, coordinatorId)).submittedAt).toBe(before);
  });

  // The note is not cleared: US-7.2 AC3 wants the clarification shown with the
  // event, and the constraint only requires a note while the status is
  // clarification_requested.
  it('keeps the clarification on the record after it has been addressed', async () => {
    const id = await createRequest('submitted');
    await assignTo(id, coordinatorId);
    await requestClarification(id, { note: 'Please confirm the venue' }, coordinatorId);

    await markEventRequestSubmitted(supabase, id);

    const view = await getClarificationView(id, asOwningOrganiser());
    expect(view.status).toBe('submitted');
    expect(view.clarificationNote).toBe('Please confirm the venue');
  });

  // Bug found via manual testing on 2026-09-16: a second clarification round
  // overwrote clarification_note correctly but left clarification_requested_at
  // frozen at the first round's time. set_clarification_requested_at fired
  // only on a null -> not-null transition, and a resubmitted request's note is
  // never cleared to null (see the test above). A first fix compared the
  // note's text, which still missed a Coordinator re-sending the identical
  // question; the trigger now keys on the submitted -> clarification_requested
  // status transition and ignores the note entirely.
  it('stamps a fresh timestamp on a second clarification, not just the first', async () => {
    const id = await createRequest('submitted');
    await assignTo(id, coordinatorId);
    await requestClarification(id, { note: 'First question' }, coordinatorId);
    const firstRequestedAt = (await getReviewDetail(id, coordinatorId)).clarificationRequestedAt;

    await markEventRequestSubmitted(supabase, id);
    // The clock backing `now()` in Postgres is second-resolution in some
    // environments; without this, a same-second second round could produce
    // an identical timestamp for a reason that has nothing to do with the bug.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await requestClarification(id, { note: 'Second question' }, coordinatorId);

    const detail = await getReviewDetail(id, coordinatorId);
    expect(detail.clarificationNote).toBe('Second question');
    expect(detail.clarificationRequestedAt).not.toBeNull();
    expect(detail.clarificationRequestedAt).not.toBe(firstRequestedAt);
    expect(new Date(detail.clarificationRequestedAt!).getTime()).toBeGreaterThan(
      new Date(firstRequestedAt!).getTime(),
    );
  });

  // The case the test above cannot catch, because it asks two *different*
  // questions: a Coordinator re-asking the SAME question, which happens when
  // the Organiser resubmits without actually answering it. An earlier version
  // of set_clarification_requested_at only re-stamped when the note's text
  // changed, so this path left clarification_requested_at frozen at the first
  // ask while status and clarification_requested_by both moved on.
  it('stamps a fresh timestamp even when the same question is asked again', async () => {
    const SAME_QUESTION = 'Please add the expected attendance';
    const id = await createRequest('submitted');
    await assignTo(id, coordinatorId);
    await requestClarification(id, { note: SAME_QUESTION }, coordinatorId);
    const firstRequestedAt = (await getReviewDetail(id, coordinatorId)).clarificationRequestedAt;

    await markEventRequestSubmitted(supabase, id);
    // Same reason as the test above: second-resolution clocks would otherwise
    // make an unchanged timestamp look correct.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await requestClarification(id, { note: SAME_QUESTION }, coordinatorId);

    const detail = await getReviewDetail(id, coordinatorId);
    expect(detail.clarificationNote).toBe(SAME_QUESTION);
    expect(new Date(detail.clarificationRequestedAt!).getTime()).toBeGreaterThan(
      new Date(firstRequestedAt!).getTime(),
    );
  });

  it('still refuses to resubmit a request that is already submitted', async () => {
    const id = await createRequest('submitted');

    const { data } = await markEventRequestSubmitted(supabase, id);

    expect(data).toBeNull();
  });
});

describe('getClarificationView', () => {
  // A draft has no coordinator_id, so canViewClarification's "unassigned, open
  // to any Coordinator" branch would otherwise let every Coordinator confirm
  // the id exists.
  it('reports an organiser\'s draft as not found to a coordinator', async () => {
    const id = await createRequest('draft', { purpose: 'Still being written' });

    await expect(
      getClarificationView(id, asCoordinator(unrelatedCoordinatorId)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // The other half of that rule, and the reason it is not a blanket refusal
  // like getReviewDetail's: the Organiser's own page calls this read for their
  // own draft, so refusing the owner would break that page.
  it('still shows the owning organiser their own draft', async () => {
    const id = await createRequest('draft', { purpose: 'Still being written' });

    const view = await getClarificationView(id, asOwningOrganiser());

    expect(view.status).toBe('draft');
    expect(view.clarificationNote).toBeNull();
  });

  // US-7.2-TC01 (AC1) "visible to the Organiser"
  it('shows the note to the organiser the request belongs to', async () => {
    const id = await createRequest('submitted');
    await assignTo(id, coordinatorId);
    await requestClarification(id, { note: 'Please confirm the expected AV setup' }, coordinatorId);

    const view = await getClarificationView(id, asOwningOrganiser());

    expect(view.clarificationNote).toBe('Please confirm the expected AV setup');
    expect(view.clarificationRequestedAt).not.toBeNull();
    expect(view.status).toBe('clarification_requested');
  });

  // US-7.2-TC03 (AC3) "anyone with access" — a Coordinator entitled to review
  // it is the other half of "with access".
  it('shows the note to a coordinator entitled to review the request', async () => {
    const id = await createRequest('submitted');
    await assignTo(id, otherCoordinatorId);
    await requestClarification(id, { note: 'Please confirm the venue' }, otherCoordinatorId);

    const view = await getClarificationView(id, asCoordinator(otherCoordinatorId));

    expect(view.clarificationNote).toBe('Please confirm the venue');
  });

  // The hole this replaced: "anyone with access" was read as any signed-in
  // account, so any user could read any request's note and status by id.
  // The caller is another Organiser, not an Attendee: an Attendee-only account
  // is refused by SCRUM-72's carve-out before canViewClarification runs, so it
  // would pass with this rule removed. The message pins which refusal fired.
  it('refuses a signed-in user with no connection to the request', async () => {
    const id = await createRequest('submitted');
    await assignTo(id, coordinatorId);
    await requestClarification(id, { note: 'Please confirm the venue' }, coordinatorId);

    await expect(
      getClarificationView(id, { userId: unrelatedCoordinatorId, roles: ['event_organiser'] }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'This event request belongs to someone else.',
    });
  });

  // SCRUM-96 AC4 — a coordinator reassigned away loses the note with the event.
  it('refuses a coordinator the request is assigned away from', async () => {
    const id = await createRequest('submitted');
    await assignTo(id, otherCoordinatorId);

    await expect(
      getClarificationView(id, asCoordinator(unrelatedCoordinatorId)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('shows no note for a request nobody has asked about', async () => {
    const id = await createRequest('submitted');

    const view = await getClarificationView(id, asOwningOrganiser());

    expect(view.clarificationNote).toBeNull();
    expect(view.clarificationRequestedAt).toBeNull();
  });

  // AC3's "and any response" half is SCRUM-91 and is not built; this asserts
  // the view does not pretend otherwise.
  it('does not claim to carry a response', async () => {
    const id = await createRequest('submitted');

    const view = await getClarificationView(id, asOwningOrganiser());

    expect(view).not.toHaveProperty('response');
  });

  it('reports an unknown request as not found', async () => {
    await expect(
      getClarificationView('99999999-9999-4999-8999-999999999999', asOwningOrganiser()),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// ---------------------------------------------------------------------------
// SCRUM-72 AC1/AC2 — an Attendee-only account may not read the coordinator's
// note by requesting it directly, narrowing US-7.2's "anyone" per customer
// clarification #91.
// ---------------------------------------------------------------------------
describe('getClarificationView: SCRUM-72 AC1/AC2', () => {
  it('refuses an Attendee-only account and returns no clarification note', async () => {
    const id = await createRequest('submitted');
    await assignTo(id, coordinatorId);
    await requestClarification(id, { note: 'Please confirm the expected AV setup' }, coordinatorId);

    await expect(
      getClarificationView(id, { userId: unrelatedCoordinatorId, roles: ['attendee'] }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  // The account is the request's own organiser as well as an Attendee: the
  // carve-out is about holding the Attendee role only, not about holding it at
  // all. Given a userId here because canViewClarification (SCRUM-90) now also
  // asks *which* organiser is reading — before that, roles alone were enough.
  it('still allows an account holding both Attendee and a planning role', async () => {
    const id = await createRequest('submitted');
    await assignTo(id, coordinatorId);
    await requestClarification(id, { note: 'Please confirm the expected AV setup' }, coordinatorId);

    const view = await getClarificationView(id, {
      userId: coordinatorId,
      roles: ['attendee', 'event_organiser'],
    });
    expect(view.clarificationNote).toBe('Please confirm the expected AV setup');
  });
});
