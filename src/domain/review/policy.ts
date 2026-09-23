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
