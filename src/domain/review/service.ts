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
import { isOwnRequest } from '@/domain/event-request/policy';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import { isActionPermitted } from '@/domain/identity/permissions';
import type { Role } from '@/domain/identity/roles';
import { toEventRequest, type EventRequest } from '@/domain/event-request/service';
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
  canViewApproval,
  canViewClarification,
  canViewRejection,
  isReviewable,
  type Commitments,
} from './policy';
import { createNotification } from '@/domain/notification/service';

/**
 * SCRUM-92 — Approve a request so planning can proceed.
 *
 * Orchestration only: validates the input, applies the rules from policy.ts,
 * and calls functions in src/lib/supabase/eventRequests.ts. Per
 * docs/architecture.md (rule 3) it never imports a Supabase client or builds a
 * query itself.
 */

/**
 * SCRUM-198: best-effort notification. The review decision above has already
 * succeeded and been written; a notification failure here must never undo it
 * or surface as an error to the caller, so this catches and swallows rather
 * than throwing.
 */
async function notifyBestEffort(notification: Parameters<typeof createNotification>[0]): Promise<void> {
  try {
    await createNotification(notification);
  } catch (error) {
    console.error('Could not create notification', notification.type, notification.eventRequestId, error);
  }
}

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

  const approvedRow = data as unknown as EventRequestRow;
  // SCRUM-198 AC2: the organiser is notified that planning may proceed
  // without committing a venue or equipment (customer clarification #80,
  // the same statement getApprovalView shows).
  await notifyBestEffort({
    recipientId: approvedRow.organiser_id,
    type: 'request_approved',
    eventRequestId: approvedRow.id,
    message: `${approvedRow.reference} (${approvedRow.name}) was approved. Planning may proceed; no venue or equipment is committed yet.`,
  });

  return toApprovalOutcome(approvedRow);
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
 * the decision - so decided_by is deliberately left out of a view the organiser
 * reads.
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
 * Who may view: the owner, the request's coordinator and Operations Managers
 * (canViewApproval). This read used to answer anyone signed in, on the reading
 * that AC3's "anyone" meant exactly that; customer clarification #91 ties
 * access to role and relationship to the event, which is how the rejection and
 * clarification reads beside it already work. Everyone else is refused with
 * 403, after the row is read, because who may see it depends on who the
 * request belongs to.
 *
 * SCRUM-72 AC2 — an Attendee-only account is refused before anything is read;
 * see isAttendeeOnly's comment in domain/identity/policy.ts.
 *
 * The commitment flags and statement are returned for every request, decided
 * or not, because this sprint nothing can be committed against any request.
 */
export async function getApprovalView(
  id: string,
  actor: { userId: string; roles: readonly Role[] },
): Promise<ApprovalView> {
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
  if (!canViewApproval({ organiserId: row.organiser_id, coordinatorId: row.coordinator_id }, actor)) {
    throw new ForbiddenError('This approval is not yours to read.');
  }

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
  // Checked before the assignment rule, and reported as not found: a draft is
  // the Organiser's private working copy and carries no coordinator_id, so
  // canReviewDetail would otherwise read it as "unassigned, open to any
  // Coordinator". See isReviewable.
  if (!isReviewable(row.status)) throw new NotFoundError('Event request');
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
 * Carries the question, not the reply. SCRUM-91 built the reply as its own
 * module (domain/clarification/service.ts — getClarificationExchange returns
 * every round), so this view is deliberately the narrow "what is outstanding
 * right now" read the pages use beside it, not a second way to read the
 * exchange.
 */
export interface ClarificationView {
  id: string;
  status: EventRequestStatus;
  clarificationNote: string | null;
  clarificationRequestedAt: string | null;
}

/**
 * AC1/AC3 — the Organiser the request belongs to, a Coordinator entitled to
 * review it, or an Event Operations Manager reads the clarification note.
 *
 * "Anyone with access" (AC3) was previously read as any signed-in account,
 * which made this the one route where a request's status and a Coordinator's
 * free-text note about someone else's event could be read by id, by anybody.
 * canViewClarification in policy.ts is what "with access" means now: the
 * owning Organiser, a Coordinator on the same terms as the review read (so
 * one reassigned away loses the note with the request), or the Operations
 * Manager who decides who owns it. The same set of people as SCRUM-91's
 * canViewClarificationExchange, so the two clarification reads cannot
 * disagree about one request.
 *
 * SCRUM-72 AC1/AC2 — an Attendee-only account is refused first, before the
 * row is read. canViewClarification would refuse them anyway (an Attendee is
 * none of the three), but the check stays where SCRUM-72 put it: that card
 * owns the wording an Attendee is given, and its AC is about the carve-out
 * itself rather than about who else may read. See isAttendeeOnly's comment in
 * domain/identity/policy.ts.
 *
 * `actor` comes from getCurrentActor, never from the request.
 */
export async function getClarificationView(
  id: string,
  actor: { userId: string; roles: readonly Role[] },
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
  // A draft is the Organiser's private working copy and carries no
  // coordinator_id, so canViewClarification's "unassigned, open to any
  // Coordinator" branch would otherwise let every Coordinator confirm the id
  // exists. Only its owner may read it.
  //
  // Not a blanket refusal, unlike getReviewDetail's: this read is also what
  // the Organiser's own page calls for their own draft (events/[id]/page.tsx
  // calls it only when isOwner), so refusing the owner would break that page.
  // Reported as not found rather than forbidden, so the refusal does not
  // itself confirm the draft.
  if (!isReviewable(row.status) && !isOwnRequest({ organiserId: row.organiser_id }, actor.userId)) {
    throw new NotFoundError('Event request');
  }

  const permitted = canViewClarification(
    { organiserId: row.organiser_id, coordinatorId: row.coordinator_id },
    {
      userId: actor.userId,
      // The same permission the review route asserts, so "may review" means
      // one thing across both reads.
      isCoordinator: isActionPermitted(actor.roles, 'event_request_review'),
      // Same permission SCRUM-91 reads for the exchange, so the two
      // clarification reads cannot disagree about who an Operations Manager is.
      isOperationsManager: isActionPermitted(actor.roles, 'coordinator_assignment'),
    },
  );
  if (!permitted) {
    throw new ForbiddenError('This event request belongs to someone else.');
  }

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
  // A draft has never been sent to anyone, so there is nothing to clarify and
  // no Coordinator has any business learning the id exists. Checked before
  // both the assignment and status rules below: a draft carries no
  // coordinator_id, so canReviewDetail would pass it, and
  // canRequestClarification would then answer with an InvalidTransitionError
  // naming the status ("cannot move from draft"), which confirms the draft
  // just as plainly as returning it would. Blanket rather than
  // owner-exempt, unlike getClarificationView's: clarifying is a review
  // action, and an Organiser has no reason to raise one on their own draft.
  if (!isReviewable(current.status)) throw new NotFoundError('Event request');
  // Raising a clarification is an act of reviewing the request, so it takes
  // the same per-event rule the review read takes (canReviewDetail). Without
  // it the route's role check was the only gate, and every Coordinator holds
  // that role: a Coordinator reassigned away could still move someone else's
  // event to Clarification Requested and send its Organiser a note, which
  // SCRUM-96 AC4 refuses. Reported by SCRUM-96's owner against merged code.
  //
  // Checked before the status check on purpose, as approveEventRequest does:
  // AC4 returns "no planning information", and an InvalidTransitionError
  // names the current status ("cannot move from approved"). Raised in review
  // of PR #57.
  if (!canReviewDetail(current.coordinator_id, actorId)) {
    throw new ForbiddenError('This event request is assigned to another Event Coordinator.');
  }
  if (!canRequestClarification(current.status)) {
    throw new InvalidTransitionError(current.status, 'clarification_requested');
  }

  // The check above is a read; the assignment can change between it and the
  // write. The UPDATE carries the same rule (see
  // markEventRequestClarificationRequested), so a reassignment landing in
  // between makes it miss rather than be written over.
  const { data, error } = await markEventRequestClarificationRequested(
    parsedId.data,
    parsedInput.data.note,
    actorId,
  );
  if (error) {
    throw new ValidationError('The clarification request could not be saved.', error.message);
  }
  // The checks above saw a submitted request this Coordinator may act on, yet
  // no row matched the filters. Two different things can have happened in
  // between, and they need different answers - see clarificationRaceError.
  if (!data) throw await clarificationRaceError(parsedId.data, actorId);

  const clarifiedRow = data as unknown as EventRequestRow;
  // SCRUM-198 AC1: the organiser is notified with the coordinator's note.
  // Best-effort: the decision above already succeeded, so a notification
  // failure must not undo it.
  await notifyBestEffort({
    recipientId: clarifiedRow.organiser_id,
    type: 'clarification_requested',
    eventRequestId: clarifiedRow.id,
    message: `Clarification requested on ${clarifiedRow.reference} (${clarifiedRow.name}): ${parsedInput.data.note}`,
  });

  return toClarificationOutcome(clarifiedRow);
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
  // SCRUM-96 AC4 — a coordinator reassigned away from an event could still
  // reject it, because the route's permission check is one every Coordinator
  // holds. Mirrors approveEventRequest's SCRUM-213 check, including its order:
  // checked before the status check so an InvalidTransitionError cannot tell
  // them the event's current status. canReviewDetail, not
  // requireCurrentCoordinator, so an event with no coordinator yet may still
  // be rejected - same reasoning as approve.
  if (!canReviewDetail(current.coordinator_id, actorId)) {
    throw new ForbiddenError('This event request is assigned to another Event Coordinator.');
  }
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
  // The checks above saw a submitted request this Coordinator may act on, yet
  // no row matched the filters. Two different things can have happened in
  // between, and they need different answers - see rejectionRaceError.
  if (!data) throw await rejectionRaceError(parsedId.data, actorId);

  const rejectedRow = data as unknown as EventRequestRow;
  // SCRUM-198 AC3: the organiser is notified with the recorded reason.
  await notifyBestEffort({
    recipientId: rejectedRow.organiser_id,
    type: 'request_rejected',
    eventRequestId: rejectedRow.id,
    message: `${rejectedRow.reference} (${rejectedRow.name}) was rejected: ${parsedInput.data.reason}`,
  });

  return toRejectionOutcome(rejectedRow);
}

/**
 * Why a conditional rejection matched no row.
 *
 * Mirrors approvalRaceError (SCRUM-213) and clarificationRaceError rather than
 * sharing them, for the same reason clarificationRaceError gives: another
 * Coordinator acted first (a ConflictError, as before), or an Event Operations
 * Manager reassigned the event out from under this one mid-request, which
 * SCRUM-96 AC4 wants reported as a denial.
 */
async function rejectionRaceError(id: string, actorId: string): Promise<Error> {
  const { data, error } = await fetchEventRequestById(id);
  // A failed read is not a missing request - the row was read a moment ago.
  if (error) return new ValidationError('The event request could not be read.', error.message);

  const row = data as unknown as EventRequestRow | null;
  if (!row) return new NotFoundError('Event request');

  if (!canReviewDetail(row.coordinator_id, actorId)) {
    return new ForbiddenError('This event request was reassigned to another Event Coordinator.');
  }
  return new ConflictError('Someone else already acted on this request.');
}

/**
 * Why a conditional clarification request matched no row.
 *
 * Mirrors approvalRaceError (SCRUM-213) rather than sharing it: that function
 * is SCRUM-92's, and folding both into one would mean editing it from this
 * story. The shape is the same because the two races are the same - another
 * Coordinator acted first, or an Event Operations Manager reassigned the
 * event out from under this one mid-request - and SCRUM-96 AC4 wants the
 * second reported as a denial, not a generic conflict.
 *
 * Raised in review of PR #32: the earlier single ConflictError said "someone
 * else already acted", which is right for the first race and misleading for
 * the second. This is the first place either race reaches a Coordinator
 * through a form they submit themselves, so the message has to say what
 * actually happened.
 */
async function clarificationRaceError(id: string, actorId: string): Promise<Error> {
  const { data, error } = await fetchEventRequestById(id);
  // A failed read is not a missing request - the row was read a moment ago.
  if (error) return new ValidationError('The event request could not be read.', error.message);

  const row = data as unknown as EventRequestRow | null;
  if (!row) return new NotFoundError('Event request');

  if (!canReviewDetail(row.coordinator_id, actorId)) {
    return new ForbiddenError('This event request was reassigned to another Event Coordinator.');
  }
  return new ConflictError('Someone else already acted on this request.');
}
