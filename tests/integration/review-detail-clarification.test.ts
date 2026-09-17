import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getClarificationView,
  getReviewDetail,
  requestClarification,
} from '@/domain/review/service';
import { isAwaitingReview } from '@/domain/review/policy';
import { markEventRequestSubmitted } from '@/lib/supabase/eventRequests';

/**
 * SCRUM-89 / SCRUM-90 — US-7.1 AC2 and US-7.2 AC1/AC3, from
 * `ConnectSphere_Test_Cases_v3.xlsx` ("User Stories & ACs" / "Test Cases"):
 *   US-7.1-TC02 — "Open the request from the queue" -> all submitted fields,
 *        including venue, equipment and registration requirements, are visible.
 *        (The attachments clause of that TC is not covered: no attachment
 *        feature exists in this codebase — see docs/SCRUM-89-90-summary.md.)
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
const createdRequestIds: string[] = [];

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

    await expect(requestClarification(id, { note: '   ' }, coordinatorId)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    const detail = await getReviewDetail(id, coordinatorId);
    expect(detail.status).toBe('submitted');
    expect(detail.clarificationNote).toBeNull();
  });

  it('refuses a draft, which has not been submitted for review yet', async () => {
    const id = await createRequest('draft');

    await expect(
      requestClarification(id, { note: 'Anything' }, coordinatorId),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  // The `.eq('status','submitted')` filter is what makes this safe; a second
  // note before the Organiser has replied does not overwrite the first.
  it('refuses a second clarification while one is already outstanding', async () => {
    const id = await createRequest('submitted');
    await requestClarification(id, { note: 'First question' }, coordinatorId);

    await expect(
      requestClarification(id, { note: 'Second question' }, coordinatorId),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

    const detail = await getReviewDetail(id, coordinatorId);
    expect(detail.clarificationNote).toBe('First question');
  });

  // US-7.1-TC03 (AC3) — once clarified, it is no longer awaiting review.
  it('takes the request out of the awaiting-review queue', async () => {
    const id = await createRequest('submitted');
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
    await requestClarification(id, { note: 'Please confirm the venue' }, coordinatorId);

    const { data, error } = await markEventRequestSubmitted(supabase, id);

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect((data as unknown as { status: string }).status).toBe('submitted');
  });

  it('keeps the original submission time, so it holds its place in the queue', async () => {
    const id = await createRequest('submitted');
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
    await requestClarification(id, { note: 'Please confirm the venue' }, coordinatorId);

    await markEventRequestSubmitted(supabase, id);

    const view = await getClarificationView(id);
    expect(view.status).toBe('submitted');
    expect(view.clarificationNote).toBe('Please confirm the venue');
  });

  // Bug found via manual testing on 2026-09-16: a second clarification round
  // overwrote clarification_note correctly but left clarification_requested_at
  // frozen at the first round's time, because set_clarification_requested_at
  // originally only fired on a null -> not-null transition, and a resubmitted
  // request's note is never cleared to null (see the test above). Fixed by
  // firing on any change to the note's value instead.
  it('stamps a fresh timestamp on a second clarification, not just the first', async () => {
    const id = await createRequest('submitted');
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
  // US-7.2-TC01 (AC1) "visible to the Organiser" / US-7.2-TC03 (AC3)
  it('shows the note to a viewer who holds no review permission', async () => {
    const id = await createRequest('submitted');
    await requestClarification(id, { note: 'Please confirm the expected AV setup' }, coordinatorId);

    const view = await getClarificationView(id);

    expect(view.clarificationNote).toBe('Please confirm the expected AV setup');
    expect(view.clarificationRequestedAt).not.toBeNull();
    expect(view.status).toBe('clarification_requested');
  });

  it('shows no note for a request nobody has asked about', async () => {
    const id = await createRequest('submitted');

    const view = await getClarificationView(id);

    expect(view.clarificationNote).toBeNull();
    expect(view.clarificationRequestedAt).toBeNull();
  });

  // AC3's "and any response" half is SCRUM-91 and is not built; this asserts
  // the view does not pretend otherwise.
  it('does not claim to carry a response', async () => {
    const id = await createRequest('submitted');

    const view = await getClarificationView(id);

    expect(view).not.toHaveProperty('response');
  });

  it('reports an unknown request as not found', async () => {
    await expect(
      getClarificationView('99999999-9999-4999-8999-999999999999'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
