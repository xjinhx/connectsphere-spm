import type { EventRequestStatus } from '@/domain/event-request/schema';

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
