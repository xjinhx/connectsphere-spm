import {
  fetchEventRequestById,
  markEventRequestApproved,
  markEventRequestClarificationRequested,
  markEventRequestRejected,
  type EventRequestRow,
} from '@/lib/supabase/eventRequests';
import {
  ConflictError,
  ForbiddenError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
} from '@/domain/shared/errors';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import { toEventRequest, type EventRequest } from '@/domain/event-request/service';
import type { Role } from '@/domain/identity/roles';
import { isAttendeeOnly } from '@/domain/identity/policy';
import {
  ApproveInputSchema,
  EventRequestIdSchema,
  RejectInputSchema,
  RequestClarificationInputSchema,
  type Decision,
} from './schema';
import {
  COMMITMENT_STATEMENT,
  NO_COMMITMENTS,
  canBeApproved,
  canBeRejected,
  canRequestClarification,
  canReviewDetail,
  canViewRejection,
  type Commitments,
} from './policy';

/**
 * SCRUM-92 — Approve a request so planning can proceed.
 *
 * Orchestration only: validates the input, applies the rules from policy.ts,
 * and calls functions in src/lib/supabase/eventRequests.ts. Per
 * docs/architecture.md (rule 3) it never imports a Supabase client or builds a
 * query itself.
 */

// ---------------------------------------------------------------------------
// AC1 — approve
// ---------------------------------------------------------------------------

/**
 * What AC1 records. Deliberately smaller than event-request's EventRequest:
 * approving reports the decision, not the whole request.
 */
export interface ApprovalOutcome {
  id: string;
  status: EventRequestStatus;
  decision: Decision;
  decidedBy: string;
  /** An instant, stamped by the database (see the set_decided_at trigger). */
  decidedAt: string;
}

function toApprovalOutcome(row: EventRequestRow): ApprovalOutcome {
  // The event_request_decision_complete constraint guarantees the three are
  // written together, so this cannot happen for a row that was just approved.
  // Checked rather than asserted, because the alternative is a non-null
  // assertion that would hide a real inconsistency if one ever occurred.
  if (row.decision === null || row.decided_by === null || row.decided_at === null) {
    throw new ValidationError('The approval was recorded incompletely.');
  }

  return {
    id: row.id,
    status: row.status,
    decision: row.decision,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
  };
}

/**
 * AC1 — a submitted request becomes approved, and the decision, the decision
 * maker and the timestamp are recorded against it.
 *
 * Approving commits ConnectSphere to nothing: no venue, equipment or
 * registration record is created here or anywhere else in this story
 * (customer clarification #80).
 *
 * `input.actorId` is the decision maker. The approve route supplies it from the
 * signed-in session, so it cannot be chosen by whoever sends the request.
 */
export async function approveEventRequest(id: string, input: unknown): Promise<ApprovalOutcome> {
  const parsedId = EventRequestIdSchema.safeParse(id);
  if (!parsedId.success) throw new NotFoundError('Event request');

  const parsedInput = ApproveInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new ValidationError('The approval is not valid.', parsedInput.error.flatten());
  }

  const { data: existing, error: readError } = await fetchEventRequestById(parsedId.data);
  if (readError) {
    throw new ValidationError('The event request could not be read.', readError.message);
  }
  if (!existing) throw new NotFoundError('Event request');

  const current = existing as unknown as EventRequestRow;

  // SCRUM-213 — the coordinator an event was taken away from could still
  // approve it. Checked before the status check on purpose: a coordinator this
  // event is not assigned to should learn nothing about it, not even whether it
  // is still awaiting a decision.
  //
  // SCRUM-96 AC4: "Given I have been reassigned away from an event, when I
  // request that event directly by its identifier, then access is denied and no
  // planning information is returned." Approving is requesting it by its
  // identifier and then acting on it, so the same denial applies.
  //
  // canReviewDetail, not SCRUM-96's requireCurrentCoordinator: this card's AC1
  // reads "Given I am reviewing a submitted request", so the gate is review
  // access, and review access allows an event with no coordinator yet (SCRUM-89).
  // requireCurrentCoordinator refuses those, which would offer a coordinator a
  // review page they may open and an approval that always fails. It would also
  // re-read a row this function already holds.
  if (!canReviewDetail(current.coordinator_id, parsedInput.data.actorId)) {
    throw new ForbiddenError('This event is not assigned to you.');
  }

  if (!canBeApproved(current.status)) {
    throw new InvalidTransitionError(current.status, 'approved');
  }

  const { data, error } = await markEventRequestApproved(parsedId.data, parsedInput.data.actorId);
  if (error) {
    throw new ValidationError('The event request could not be approved.', error.message);
  }
  // The checks above saw a submitted request this coordinator may act on, yet no
  // row matched the filters. Something changed in between, and the two causes
  // need different answers - so the row is re-read to say which.
  if (!data) throw await approvalRaceError(parsedId.data, parsedInput.data.actorId);

  return toApprovalOutcome(data as unknown as EventRequestRow);
}

/**
 * SCRUM-213 — why a conditional approval matched no row.
 *
 * Two races end up here, and telling them apart matters to whoever came second:
 * another coordinator decided it first, or an Event Operations Manager
 * reassigned the event out from under this one mid-request. Reported as a
 * refusal rather than a silent no-op, the same as assignCoordinator's AC5.
 */
async function approvalRaceError(id: string, actorId: string): Promise<Error> {
  const { data, error } = await fetchEventRequestById(id);
  // A failed read is not a missing request. This row was read successfully a
  // moment ago, so reporting "not found" here would send whoever is debugging a
  // transient database fault looking for a deleted event. Reported the same way
  // the first read reports it.
  if (error) return new ValidationError('The event request could not be read.', error.message);

  const row = data as unknown as EventRequestRow | null;
  // Genuinely gone: deleted between the update and this read.
  if (!row) return new NotFoundError('Event request');

  if (!canReviewDetail(row.coordinator_id, actorId)) {
    return new ForbiddenError('This event was reassigned to another coordinator.');
  }
  return new InvalidTransitionError(row.status, 'approved');
}

// ---------------------------------------------------------------------------
// AC2 / AC3 — view the approval
// ---------------------------------------------------------------------------

/**
 * What anyone viewing a request is told about its approval.
 *
 * AC2 asks for "the approval outcome and date" and the statement - not who made
 * the decision - so decided_by is deliberately left out of a view that any
 * signed-in user can read.
 */
export interface ApprovalView {
  id: string;
  status: EventRequestStatus;
  /** The approval outcome. Null until the request has been decided. */
  decision: Decision | null;
  /** The approval date: an instant stamped by the database, or null. */
  decidedAt: string | null;
  commitments: Commitments;
  commitmentStatement: string;
}

/**
 * AC2 — the organiser sees the outcome and date with the statement that nothing
 * is yet committed.
 * AC3 — anyone viewing an approved request sees it is not confirmed, and that
 * no venue or equipment is committed.
 *
 * Who may view: Jira AC3 says "anyone", so there is no ownership or role check
 * here beyond SCRUM-72's carve-out below; the middleware already refuses the
 * route without a signed-in session. This is a separate read from
 * event-request's getEventRequest, whose rule is that only the owning
 * organiser may read a request - widening that rule would mean changing
 * SCRUM-82's logic from this story.
 *
 * SCRUM-72 AC2 — "anyone" stops short of an Attendee-only account requesting
 * this directly; see isAttendeeOnly's comment in domain/identity/policy.ts.
 *
 * The commitment flags and statement are returned for every request, decided
 * or not, because this sprint nothing can be committed against any request.
 */
export async function getApprovalView(id: string, actor: { roles: readonly Role[] }): Promise<ApprovalView> {
  if (isAttendeeOnly([...actor.roles])) {
    throw new ForbiddenError('This information is not available to Attendees.');
  }

  const parsedId = EventRequestIdSchema.safeParse(id);
  if (!parsedId.success) throw new NotFoundError('Event request');

  const { data, error } = await fetchEventRequestById(parsedId.data);
  if (error) {
    throw new ValidationError('The event request could not be read.', error.message);
  }
  if (!data) throw new NotFoundError('Event request');

  const row = data as unknown as EventRequestRow;
  return {
    id: row.id,
    status: row.status,
    decision: row.decision,
    decidedAt: row.decided_at,
    commitments: { ...NO_COMMITMENTS },
    commitmentStatement: COMMITMENT_STATEMENT,
  };
}

// ---------------------------------------------------------------------------
// SCRUM-89 — Review the full detail of a request
// ---------------------------------------------------------------------------

/**
 * AC1 — every field the Event Organiser supplied, exactly as submitted, plus
 * SCRUM-90's clarification note if one has been raised. Built on
 * toEventRequest (event-request/service.ts) rather than a second mapper, so
 * this can never list a field the Organiser's own view does not also show.
 *
 * AC2 — nothing here omits a blank field: toEventRequest already carries
 * every column as `null` rather than dropping the key when it was never
 * filled in, so "not provided" is a rendering choice for whoever calls this
 * (there is no dedicated review page this sprint - see CLAUDE.md's Sprint 1
 * scope), not something this function has to construct.
 */
export interface ReviewDetail extends EventRequest {
  clarificationNote: string | null;
  clarificationRequestedBy: string | null;
  clarificationRequestedAt: string | null;
}

/**
 * AC1 — "Given I am the assigned coordinator and I open a submitted request
 * ... every field the Event Organiser supplied is displayed with the value
 * that was submitted."
 * AC3 — "Given a submitted request is assigned to another Event Coordinator,
 * when I request it directly by its identifier, then access is denied and no
 * request data is returned." Enforced by canReviewDetail in policy.ts, and
 * thrown before the row is mapped, so nothing about the request leaves this
 * function when access is refused.
 *
 * `actorUserId` is the signed-in Coordinator, supplied by the caller from
 * getCurrentActor, never from the request — same reasoning as every other
 * actorId in this file.
 */
export async function getReviewDetail(id: string, actorUserId: string): Promise<ReviewDetail> {
  const parsedId = EventRequestIdSchema.safeParse(id);
  if (!parsedId.success) throw new NotFoundError('Event request');

  const { data, error } = await fetchEventRequestById(parsedId.data);
  if (error) {
    throw new ValidationError('The event request could not be read.', error.message);
  }
  if (!data) throw new NotFoundError('Event request');

  const row = data as unknown as EventRequestRow;
  if (!canReviewDetail(row.coordinator_id, actorUserId)) {
    throw new ForbiddenError('This event request is assigned to another Event Coordinator.');
  }

  return {
    ...toEventRequest(row),
    clarificationNote: row.clarification_note,
    clarificationRequestedBy: row.clarification_requested_by,
    clarificationRequestedAt: row.clarification_requested_at,
  };
}

// ---------------------------------------------------------------------------
// SCRUM-90 — Request clarification from the Event Organiser
// ---------------------------------------------------------------------------

/** What AC1 records. Smaller than EventRequest, same reasoning as ApprovalOutcome. */
export interface ClarificationOutcome {
  id: string;
  status: EventRequestStatus;
  clarificationNote: string;
  clarificationRequestedBy: string;
  clarificationRequestedAt: string;
}

function toClarificationOutcome(row: EventRequestRow): ClarificationOutcome {
  // event_request_clarification_complete guarantees the three are written
  // together, so this cannot happen for a row just moved to
  // clarification_requested. Checked, not asserted - same reasoning as
  // toApprovalOutcome above.
  if (
    row.clarification_note === null ||
    row.clarification_requested_by === null ||
    row.clarification_requested_at === null
  ) {
    throw new ValidationError('The clarification request was recorded incompletely.');
  }

  return {
    id: row.id,
    status: row.status,
    clarificationNote: row.clarification_note,
    clarificationRequestedBy: row.clarification_requested_by,
    clarificationRequestedAt: row.clarification_requested_at,
  };
}

/**
 * What anyone viewing a request is told about its clarification state.
 *
 * US-7.2 AC1 ("saved with the event, visible to the Organiser") and AC3
 * ("anyone with access opens it -> clarification ... shown with the event")
 * — same reasoning as ApprovalView above: a separate read anyone signed-in
 * can hit, rather than widening event-request's EventRequest (which SCRUM-89's
 * own comment on toEventRequest already decided against, to match how
 * SCRUM-92 kept its decision fields out of it too).
 *
 * No response half: AC2 ("Organiser responds ... reply saved") is SCRUM-91,
 * a separate ticket not built on this branch. `response`/`respondedAt` are
 * left out entirely rather than stubbed to null, so nothing here claims to
 * answer AC2/AC3's "any response" half.
 */
export interface ClarificationView {
  id: string;
  status: EventRequestStatus;
  clarificationNote: string | null;
  clarificationRequestedAt: string | null;
}

/**
 * AC1/AC3 — the organiser (or anyone else with access to the request) reads
 * the clarification note without needing the Coordinator-only permission
 * `getReviewDetail` requires. Who may view: Jira says "the Organiser" (AC1)
 * and "anyone with access" (AC3), so no role/ownership check here beyond
 * SCRUM-72's carve-out below, same as getApprovalView — the middleware
 * already refuses this without a session.
 *
 * SCRUM-72 AC1/AC2 — the note this returns is exactly the "coordinator notes"
 * an Attendee must not get by requesting an event directly; an Attendee-only
 * account is refused before the note is read. See isAttendeeOnly's comment in
 * domain/identity/policy.ts.
 */
export async function getClarificationView(
  id: string,
  actor: { roles: readonly Role[] },
): Promise<ClarificationView> {
  if (isAttendeeOnly([...actor.roles])) {
    throw new ForbiddenError('This information is not available to Attendees.');
  }

  const parsedId = EventRequestIdSchema.safeParse(id);
  if (!parsedId.success) throw new NotFoundError('Event request');

  const { data, error } = await fetchEventRequestById(parsedId.data);
  if (error) {
    throw new ValidationError('The event request could not be read.', error.message);
  }
  if (!data) throw new NotFoundError('Event request');

  const row = data as unknown as EventRequestRow;
  return {
    id: row.id,
    status: row.status,
    clarificationNote: row.clarification_note,
    clarificationRequestedAt: row.clarification_requested_at,
  };
}

/**
 * AC1 — a submitted request moves to Clarification Requested and the note is
 * retained with the event record.
 * AC3 — a missing or blank note is blocked before anything is read or
 * written, and the organiser (in this case the Coordinator submitting the
 * form) is told a note is required.
 *
 * `actorId` is the Coordinator raising it, supplied by the route from the
 * signed-in session (getCurrentActor) - never from the request body, same
 * reasoning as approveEventRequest's actorId.
 */
export async function requestClarification(
  id: string,
  input: unknown,
  actorId: string,
): Promise<ClarificationOutcome> {
  const parsedId = EventRequestIdSchema.safeParse(id);
  if (!parsedId.success) throw new NotFoundError('Event request');

  const parsedInput = RequestClarificationInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new ValidationError(
      'A note describing what is needed is required.',
      parsedInput.error.flatten(),
    );
  }

  const { data: existing, error: readError } = await fetchEventRequestById(parsedId.data);
  if (readError) {
    throw new ValidationError('The event request could not be read.', readError.message);
  }
  if (!existing) throw new NotFoundError('Event request');

  const current = existing as unknown as EventRequestRow;
  if (!canRequestClarification(current.status)) {
    throw new InvalidTransitionError(current.status, 'clarification_requested');
  }

  const { data, error } = await markEventRequestClarificationRequested(
    parsedId.data,
    parsedInput.data.note,
    actorId,
  );
  if (error) {
    throw new ValidationError('The clarification request could not be saved.', error.message);
  }
  // The check above saw a submitted request, yet no row matched the `status =
  // submitted` filter: another coordinator acted on it in between (approved
  // it, or already asked their own question) - same race canBeApproved
  // guards against for approval.
  //
  // A conflict, not an invalid transition. InvalidTransitionError would render
  // as "An event cannot move from clarification_requested to
  // clarification_requested", which describes neither what the caller asked
  // for nor what happened: the request was never in clarification_requested
  // for them. Raised in review of PR #32 - this is the first place the race
  // reaches a Coordinator through a form they submit themselves, so the
  // message has to say who lost. approveEventRequest above still carries the
  // older wording; that is SCRUM-92's merged code, left for its owner.
  if (!data) throw new ConflictError('Someone else already acted on this request.');

  return toClarificationOutcome(data as unknown as EventRequestRow);
}

// ---------------------------------------------------------------------------
// SCRUM-93 — Reject a request
// ---------------------------------------------------------------------------

/** What AC4 records. Smaller than EventRequest, same reasoning as ApprovalOutcome. */
export interface RejectionOutcome {
  id: string;
  status: EventRequestStatus;
  decision: Decision;
  decidedBy: string;
  decidedAt: string;
  rejectionReason: string;
}

function toRejectionOutcome(row: EventRequestRow): RejectionOutcome {
  // event_request_rejection_reason_matches_decision and
  // event_request_decision_complete together guarantee all four are written
  // together, so this cannot happen for a row just moved to rejected. Checked
  // rather than asserted, same reasoning as toApprovalOutcome above.
  if (
    row.decision === null ||
    row.decided_by === null ||
    row.decided_at === null ||
    row.rejection_reason === null
  ) {
    throw new ValidationError('The rejection was recorded incompletely.');
  }

  return {
    id: row.id,
    status: row.status,
    decision: row.decision,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    rejectionReason: row.rejection_reason,
  };
}

/**
 * What anyone viewing a request is told about its rejection.
 *
 * AC4 ("recorded and visible to the Event Organiser") and AC6 ("the
 * rejection reason and date are shown") - same reasoning as
 * getApprovalView/getClarificationView above: a separate read anyone
 * signed-in can hit, rather than widening event-request's EventRequest.
 */
export interface RejectionView {
  id: string;
  status: EventRequestStatus;
  rejectionReason: string | null;
  /** The rejection date. Reuses decided_at, the same generic column approval uses. */
  decidedAt: string | null;
}

/**
 * AC4/AC6 — the organiser who owns the request, its current coordinator, and
 * the Event Operations Managers who assign coordinators read the rejection
 * reason and date, without needing the Coordinator-only permission
 * getReviewDetail requires (canViewRejection, review/policy.ts).
 *
 * Narrower than "anyone signed in", which is what this did first, copied
 * from SCRUM-90's getClarificationView - a rejection reason is free text a
 * coordinator wrote about this specific request. getClarificationView carries
 * the identical gap; see the comment on getClarificationExchange in
 * domain/clarification/service.ts for why it is flagged there rather than
 * fixed from here.
 */
export async function getRejectionView(
  id: string,
  actor: { userId: string; roles: readonly Role[] },
): Promise<RejectionView> {
  const parsedId = EventRequestIdSchema.safeParse(id);
  if (!parsedId.success) throw new NotFoundError('Event request');

  const { data, error } = await fetchEventRequestById(parsedId.data);
  if (error) {
    throw new ValidationError('The event request could not be read.', error.message);
  }
  if (!data) throw new NotFoundError('Event request');

  const row = data as unknown as EventRequestRow;
  if (
    !canViewRejection(
      { organiserId: row.organiser_id, coordinatorId: row.coordinator_id },
      actor,
    )
  ) {
    throw new ForbiddenError('This rejection is not yours to read.');
  }

  return {
    id: row.id,
    status: row.status,
    rejectionReason: row.rejection_reason,
    decidedAt: row.decided_at,
  };
}

/**
 * AC4 — a submitted request moves to Rejected and the reason, decision maker
 * and timestamp are recorded against it.
 * AC5 — a missing or blank reason is blocked before anything is read or
 * written, and the coordinator is told a reason is required.
 *
 * `actorId` is the Coordinator rejecting it, supplied by the route from the
 * signed-in session (getCurrentActor) - never from the request body, same
 * reasoning as approveEventRequest's actorId.
 */
export async function rejectEventRequest(
  id: string,
  input: unknown,
  actorId: string,
): Promise<RejectionOutcome> {
  const parsedId = EventRequestIdSchema.safeParse(id);
  if (!parsedId.success) throw new NotFoundError('Event request');

  const parsedInput = RejectInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new ValidationError(
      'A reason is required to reject this request.',
      parsedInput.error.flatten(),
    );
  }

  const { data: existing, error: readError } = await fetchEventRequestById(parsedId.data);
  if (readError) {
    throw new ValidationError('The event request could not be read.', readError.message);
  }
  if (!existing) throw new NotFoundError('Event request');

  const current = existing as unknown as EventRequestRow;
  if (!canBeRejected(current.status)) {
    throw new InvalidTransitionError(current.status, 'rejected');
  }

  const { data, error } = await markEventRequestRejected(
    parsedId.data,
    parsedInput.data.reason,
    actorId,
  );
  if (error) {
    throw new ValidationError('The event request could not be rejected.', error.message);
  }
  // The check above saw a submitted request, yet no row matched the `status =
  // submitted` filter: another coordinator acted on it in between (approved
  // it, or rejected it themselves) - same race requestClarification guards
  // against, and the same reasoning for a ConflictError over
  // InvalidTransitionError: this is new code, so it gets the clearer wording.
  if (!data) throw new ConflictError('Someone else already acted on this request.');

  return toRejectionOutcome(data as unknown as EventRequestRow);
}
