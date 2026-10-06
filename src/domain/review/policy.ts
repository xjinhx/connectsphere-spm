import type { EventRequestStatus } from '@/domain/event-request/schema';
import { isActionPermitted } from '@/domain/identity/permissions';
import type { Role } from '@/domain/identity/roles';

/**
 * SCRUM-92 — Approve a request so planning can proceed.
 *
 * AC1 describes approving a *submitted* request, and nothing else. Approving a
 * draft, or approving twice, is not on the card and is refused.
 *
 * The database enforces the same rule inside the update itself (see
 * markEventRequestApproved), which is what makes two coordinators approving at
 * the same moment safe. This function is the readable statement of the rule,
 * and gives the API a clear error instead of a silent no-op.
 */
export function canBeApproved(status: EventRequestStatus): boolean {
  return status === 'submitted';
}

// ---------------------------------------------------------------------------
// SCRUM-93 — Reject a request
// ---------------------------------------------------------------------------

/**
 * AC4 describes rejecting "a submitted request", and nothing else - same
 * reasoning as canBeApproved above: the rule is a readable statement here,
 * and the database enforces the same thing inside the update itself (see
 * markEventRequestRejected), which is what makes two coordinators deciding
 * the same request at the same moment safe.
 */
export function canBeRejected(status: EventRequestStatus): boolean {
  return status === 'submitted';
}

/**
 * AC4/AC6 — who may read the rejection reason and date: the organiser who
 * owns the request, its current coordinator, and the Event Operations
 * Managers who assign coordinators. Not "anyone signed in", which is what
 * this did first, copied from SCRUM-90's getClarificationView.
 *
 * Same rule as SCRUM-91's canViewClarificationExchange, for the same reason:
 * a rejection reason is free text a coordinator wrote about this specific
 * request, and a signed-in stranger with an id has no business reading it.
 * getClarificationView carries the identical gap and is flagged there rather
 * than fixed from here - see the comment on getClarificationExchange in
 * domain/clarification/service.ts.
 */
export function canViewRejection(
  event: { organiserId: string; coordinatorId: string | null },
  actor: { userId: string; roles: readonly Role[] },
): boolean {
  const mayReview =
    isActionPermitted(actor.roles, 'event_request_review') &&
    (event.coordinatorId === null || event.coordinatorId === actor.userId);

  return (
    event.organiserId === actor.userId ||
    mayReview ||
    isActionPermitted(actor.roles, 'coordinator_assignment')
  );
}

// ---------------------------------------------------------------------------
// AC2 / AC3 — what an approval commits ConnectSphere to
// ---------------------------------------------------------------------------

/** The arrangements a request could one day have committed against it. */
export interface Commitments {
  venue: boolean;
  equipment: boolean;
  registration: boolean;
}

/**
 * Nothing. Approval means the request holds enough information for planning to
 * begin, and commits ConnectSphere to no arrangement (customer clarification
 * #80).
 *
 * Hardcoded rather than derived, deliberately: Venue Booking, Equipment
 * Reservation and Attendee Registration are all outside Sprint 1, so there is
 * no record in the data model to read a commitment from. Deriving "false" from
 * tables that do not exist would be building the absent feature to make a test
 * pass.
 *
 * DUMMY(SCRUM-148) D-02: venue is asserted false until confirmed bookings exist.
 * DUMMY(SCRUM-21) D-02: equipment is asserted false until reservations exist.
 * DUMMY(SCRUM-22) D-02: registration is asserted false until registrations exist.
 * Once they exist, derive each flag from those records - see docs/dummies.md.
 */
export const NO_COMMITMENTS: Readonly<Commitments> = Object.freeze({
  venue: false,
  equipment: false,
  registration: false,
});

/** AC2's statement, worded as the Jira card words it. */
export const COMMITMENT_STATEMENT =
  'No venue, equipment or registration arrangement is yet committed.';

/**
 * AC2/AC3 — who may read a request's approval outcome and date: the organiser
 * who owns the request, its coordinator (or any coordinator while it has none
 * yet), and the Event Operations Managers who assign coordinators.
 *
 * AC3 says "when anyone views the event", and this read first took that as
 * anyone signed in. Customer clarification #91 settles it the other way:
 * protected information, which covers "other non-public event details" such as
 * an unpublished approval, is for users with the right "role and relationship
 * to the event". So "anyone" means anyone with a part in this request, not
 * anyone with an id.
 *
 * The same people as SCRUM-93's canViewRejection and SCRUM-90's
 * canViewClarification, deliberately: three reads of one request's review
 * outcome should not give three answers to "may I see this?". Written out here
 * rather than borrowed, as those two do, so no story's rule changes from
 * another story's code.
 *
 * A same-organisation colleague (SCRUM-204) is not included, matching those
 * two. They can still open the request itself, where the status badge tells
 * them it is Approved and not Confirmed, which is all AC3 asks them to see.
 */
export function canViewApproval(
  event: { organiserId: string; coordinatorId: string | null },
  actor: { userId: string; roles: readonly Role[] },
): boolean {
  const mayReview =
    isActionPermitted(actor.roles, 'event_request_review') &&
    (event.coordinatorId === null || event.coordinatorId === actor.userId);

  return (
    event.organiserId === actor.userId ||
    mayReview ||
    isActionPermitted(actor.roles, 'coordinator_assignment')
  );
}

/**
 * AC2/AC3 — whether the "nothing is yet committed" statement belongs on the
 * approval panel. Only while the event is still Approved: AC2 and AC3 describe
 * a request that has only been approved. Once it has moved on (Planning,
 * Confirmed, Completed, Cancelled), arrangements may exist, and on a Confirmed
 * event the statement would contradict the status above it ("All essential
 * arrangements are in place"). The approval outcome and date stay on the panel
 * at every status: the event was approved, whatever happened next.
 */
export function showsCommitmentStatement(status: EventRequestStatus): boolean {
  return status === 'approved';
}


// ---------------------------------------------------------------------------
// SCRUM-90 — Request clarification from the Event Organiser
// ---------------------------------------------------------------------------

/**
 * AC1 describes requesting clarification on "a submitted request", and
 * nothing else. Clarifying a draft, or clarifying a request that is already
 * Clarification Requested (a second note before the Organiser has responded),
 * is not on the card and is refused — same reasoning as canBeApproved above:
 * the rule is a readable statement here, and the database enforces the same
 * thing inside the update itself (see markEventRequestClarificationRequested),
 * which is what makes two coordinators requesting clarification at the same
 * moment safe.
 */
export function canRequestClarification(status: EventRequestStatus): boolean {
  return status === 'submitted';
}

// ---------------------------------------------------------------------------
// SCRUM-88 — Review submitted requests from the queue
// ---------------------------------------------------------------------------

/**
 * AC1/AC3 — a request is awaiting review for as long as it is submitted and
 * nothing has been decided yet. Once a decision is recorded (e.g. approved
 * via SCRUM-92), it should no longer appear as awaiting review.
 *
 * TODO: AC1 also says "requests assigned to me" — filtering the queue by
 * which coordinator it's assigned to is not implemented here, since there is
 * no coordinator_id column yet (SCRUM-94, Coordinator Assignment, has not
 * been built). Whoever builds the real queue page/route needs to add that
 * filter once the assignment data exists; this function only covers the
 * "awaiting review" half of the rule.
 */
export function isAwaitingReview(status: EventRequestStatus): boolean {
  return status === 'submitted';
}

// ---------------------------------------------------------------------------
// SCRUM-89 AC3 — deny a Coordinator who is not the one assigned
// ---------------------------------------------------------------------------

/**
 * AC3, quoted from the Jira card (authoritative per CLAUDE.md): "Given a
 * submitted request is assigned to another Event Coordinator, when I request
 * it directly by its identifier, then access is denied and no request data is
 * returned."
 *
 * Read literally: the card denies access when the request *is* assigned to
 * someone else. It says nothing about an unassigned request, so one is not
 * invented here — coordinator_id === null stays open to any Coordinator.
 * Assignment is a one-way Event Operations Manager action (SCRUM-94 AC4),
 * never self-service, so this never lets a Coordinator claim a request by
 * opening it.
 *
 * An earlier commit on this branch removed this check on the basis that the
 * test-case spreadsheet's consolidated US-7.1 carries no such AC. The Jira
 * card does carry it, and CLAUDE.md says Jira wins — so it is restored.
 */
export function canReviewDetail(coordinatorId: string | null, actorUserId: string): boolean {
  return coordinatorId === null || coordinatorId === actorUserId;
}

// ---------------------------------------------------------------------------
// SCRUM-89 — a draft is not a request under review
// ---------------------------------------------------------------------------

/**
 * Both SCRUM-89 ACs that describe opening a request say "a *submitted*
 * request". A draft has not been sent to anyone: it is the Organiser's
 * private working copy, which SCRUM-83 AC3 already keeps from other
 * Organisers ("a colleague's draft ... access is denied", isOwnRequest).
 *
 * Nothing said so for Coordinators, because until SCRUM-94 there was no
 * assignment to reason about. The effect was that a Coordinator could open
 * any Organiser's unfinished draft through the review route, since a draft
 * carries no coordinator_id and canReviewDetail treats "unassigned" as open
 * to all — the one case where that reading is wrong.
 *
 * Refused as *not found* rather than forbidden, deliberately: a Coordinator
 * has no business learning that a particular id exists as someone's draft.
 */
export function isReviewable(status: EventRequestStatus): boolean {
  return status !== 'draft';
}

// ---------------------------------------------------------------------------
// SCRUM-90 — who may read a clarification
// ---------------------------------------------------------------------------

/**
 * US-7.2 AC1 says the note is "visible to the Organiser" and AC3 that it is
 * shown to "anyone with access" to the request. This function is what "with
 * access" means, rather than the previous reading of it as any signed-in
 * account:
 *
 *   - the Organiser the request belongs to (AC1, and the same ownership rule
 *     event-request's own reads apply);
 *   - a Coordinator, on exactly the terms the review read allows
 *     (canReviewDetail) — so a Coordinator reassigned away loses the note at
 *     the same moment they lose the request;
 *   - an Event Operations Manager, who decides who owns the event and so has
 *     a reason to see an unanswered question about it.
 *
 * Everyone else is refused. The note is free text written by a Coordinator
 * about someone else's event, so "anyone with access" cannot sensibly mean
 * every account that happens to be logged in.
 *
 * The same set of people as SCRUM-91's canViewClarificationExchange, and
 * deliberately so: that rule governs the full exchange on the same request,
 * and its own comment reports this route as the wider hole it could not fix
 * from that story. Two different answers to "may I read this clarification?"
 * on one request would be the bug, not the fix. Written out here rather than
 * imported, matching the reasoning that function gives for not delegating to
 * SCRUM-98's near-identical rule: they agree today, and either story could
 * narrow its own without the other being wrong.
 */
export function canViewClarification(
  request: { organiserId: string; coordinatorId: string | null },
  actor: { userId: string; isCoordinator: boolean; isOperationsManager: boolean },
): boolean {
  if (request.organiserId === actor.userId) return true;
  if (actor.isOperationsManager) return true;
  if (!actor.isCoordinator) return false;
  return canReviewDetail(request.coordinatorId, actor.userId);
}
