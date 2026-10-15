import { describe, it, expect } from 'vitest';
import {
  canBeApproved,
  canBeRejected,
  canRequestClarification,
  canReviewDetail,
  canViewApproval,
  canViewClarification,
  canViewRejection,
  commitmentStatementFor,
  commitmentsFor,
  isAwaitingReview,
  isReviewable,
} from '@/domain/review/policy';

const COORDINATOR_A = '11111111-1111-1111-1111-111111111111';
const COORDINATOR_B = '22222222-2222-2222-2222-222222222222';
const ORGANISER = '33333333-3333-3333-3333-333333333333';
const STRANGER = '44444444-4444-4444-4444-444444444444';
const OPS_MANAGER = '55555555-5555-5555-5555-555555555555';

/**
 * SCRUM-92 — Approve a request so planning can proceed (US-7.3).
 *
 * AC text is from the Jira card, which is authoritative.
 *
 * Not coverable by a unit test - see tests/integration/approve-event-request.test.ts:
 *   US-7.3-TC01 — the decision, decision maker and timestamp actually landing
 *        on the row. The guard itself lives in the update statement, so only a
 *        test with a real database proves it.
 *   Two coordinators approving at once — the `.eq('status','submitted')` filter
 *        is what decides it; not reachable without a database.
 *
 * SCRUM-93 — Reject a request (US-7.3 AC4/AC5). Same reasoning applies to
 * canBeRejected below - see tests/integration/reject-event-request.test.ts for
 * what a unit test can't reach: the reason/decision/timestamp landing on the
 * row, and two coordinators deciding the same request at once.
 */

describe('canBeApproved', () => {
  // AC1: "Given I am reviewing a submitted request, when I approve it..."
  it('allows a submitted request to be approved', () => {
    expect(canBeApproved('submitted')).toBe(true);
  });

  it('refuses a draft, which has not been submitted for review yet', () => {
    expect(canBeApproved('draft')).toBe(false);
  });

  // Negative coverage for approving from an invalid starting status: approving
  // twice is refused rather than silently re-stamping the first decision.
  it('refuses a request that is already approved', () => {
    expect(canBeApproved('approved')).toBe(false);
  });
});

/**
 * SCRUM-93 — Reject a request (US-7.3).
 * AC text is from the Jira card, which is authoritative.
 */
describe('canBeRejected', () => {
  // AC4: "Given I am reviewing a submitted request, when I reject it..."
  it('allows a submitted request to be rejected', () => {
    expect(canBeRejected('submitted')).toBe(true);
  });

  it('refuses a draft, which has not been submitted for review yet', () => {
    expect(canBeRejected('draft')).toBe(false);
  });

  // Negative coverage: a request already decided cannot be decided again.
  it('refuses a request that has already been approved', () => {
    expect(canBeRejected('approved')).toBe(false);
  });

  it('refuses a request that has already been rejected', () => {
    expect(canBeRejected('rejected')).toBe(false);
  });
});

/**
 * SCRUM-90 — Request clarification from the Event Organiser (US-7.2).
 * AC text is from the Jira card, which is authoritative.
 *
 * Not coverable by a unit test — same as canBeApproved above:
 *   The note, requester and timestamp actually landing on the row, and two
 *   coordinators clarifying the same request at once — both decided by the
 *   `.eq('status','submitted')` filter in markEventRequestClarificationRequested,
 *   not reachable without a database.
 */
describe('canRequestClarification', () => {
  // AC1: "Given I am reviewing a submitted request, when I request
  // clarification..."
  it('allows clarification to be requested on a submitted request', () => {
    expect(canRequestClarification('submitted')).toBe(true);
  });

  it('refuses a draft, which has not been submitted for review yet', () => {
    expect(canRequestClarification('draft')).toBe(false);
  });

  // Negative coverage: a second clarification before the Organiser has
  // responded to the first is refused rather than silently overwriting it.
  it('refuses a request that already has clarification requested', () => {
    expect(canRequestClarification('clarification_requested')).toBe(false);
  });

  it('refuses a request that has already been approved', () => {
    expect(canRequestClarification('approved')).toBe(false);
  });
});

describe('isAwaitingReview', () => {
  // AC1/AC3: "requests assigned to me awaiting review"
  it('treats a submitted request as awaiting review', () => {
    expect(isAwaitingReview('submitted')).toBe(true);
  });

  it('does not treat a draft as awaiting review — it has not been submitted', () => {
    expect(isAwaitingReview('draft')).toBe(false);
  });

  it('does not treat an approved request as awaiting review — it has already been decided', () => {
    expect(isAwaitingReview('approved')).toBe(false);
  });
});

/**
 * SCRUM-89 AC3 (Jira, authoritative) — "Given a submitted request is assigned
 * to another Event Coordinator, when I request it directly by its identifier,
 * then access is denied and no request data is returned."
 *
 * The rule itself is unit-tested here; that getReviewDetail actually refuses
 * before mapping the row needs a database — see
 * tests/integration/review-detail-clarification.test.ts.
 */
describe('canReviewDetail', () => {
  it('allows the assigned coordinator', () => {
    expect(canReviewDetail(COORDINATOR_A, COORDINATOR_A)).toBe(true);
  });

  it('refuses a coordinator the request is not assigned to', () => {
    expect(canReviewDetail(COORDINATOR_A, COORDINATOR_B)).toBe(false);
  });

  // SCRUM-232 AC5 (Week 7 Customer Changes, change 5): assignment through the
  // Event Coordinator Lead's queue is now a precondition of review, so an
  // unassigned request is no longer open to any Coordinator. Supersedes the
  // AC3-literal reading this test used to carry. The Lead still gets a
  // read-only way in, but that OR is applied at getReviewDetail's own call
  // site (domain/review/service.ts), not inside this pure function - see
  // tests/integration/review-detail-clarification.test.ts.
  it('refuses any coordinator while the request is not yet assigned', () => {
    expect(canReviewDetail(null, COORDINATOR_A)).toBe(false);
  });
});

/**
 * SCRUM-93 AC4/AC6 — who may read the rejection reason and date. Fixed to
 * match SCRUM-91's canViewClarificationExchange (domain/clarification/policy.ts)
 * rather than the "anyone signed in" it copied from SCRUM-90's
 * getClarificationView.
 */
describe('canViewRejection', () => {
  const request = { organiserId: ORGANISER, coordinatorId: COORDINATOR_A };

  it('allows the organiser who owns the request', () => {
    expect(
      canViewRejection(request, { userId: ORGANISER, roles: ['event_organiser'] }),
    ).toBe(true);
  });

  it('allows the coordinator the request is assigned to', () => {
    expect(
      canViewRejection(request, { userId: COORDINATOR_A, roles: ['coordinator'] }),
    ).toBe(true);
  });

  it('refuses a coordinator the request is assigned away from', () => {
    expect(
      canViewRejection(request, { userId: COORDINATOR_B, roles: ['coordinator'] }),
    ).toBe(false);
  });

  // SCRUM-232 AC5: no longer open to any coordinator while unassigned - only
  // the Lead (coordinator_assignment, tested below) sees an unassigned event.
  it('refuses any coordinator while the request is not yet assigned', () => {
    expect(
      canViewRejection(
        { organiserId: ORGANISER, coordinatorId: null },
        { userId: COORDINATOR_B, roles: ['coordinator'] },
      ),
    ).toBe(false);
  });

  it('allows an Event Operations Manager, whichever coordinator it is assigned to', () => {
    expect(
      canViewRejection(request, { userId: OPS_MANAGER, roles: ['operations_manager'] }),
    ).toBe(true);
  });

  // SCRUM-232 AC5: the Lead's access does not depend on assignment existing
  // at all - they may read even an unassigned event's rejection.
  it('allows an Event Operations Manager even while the request is unassigned', () => {
    expect(
      canViewRejection(
        { organiserId: ORGANISER, coordinatorId: null },
        { userId: OPS_MANAGER, roles: ['operations_manager'] },
      ),
    ).toBe(true);
  });

  it('refuses a signed-in stranger with no role or relationship to the request', () => {
    expect(canViewRejection(request, { userId: STRANGER, roles: ['attendee'] })).toBe(false);
  });

  // SCRUM-204 AC3 — a same-organisation colleague may view the request itself,
  // but that sharing rule is a different function (canViewRequest,
  // event-request/policy.ts) with a different scope; it does not widen who may
  // read a coordinator's rejection reason.
  it('refuses a same-organisation colleague organiser who does not own this request', () => {
    expect(canViewRejection(request, { userId: STRANGER, roles: ['event_organiser'] })).toBe(
      false,
    );
  });
});

/**
 * SCRUM-92 AC2/AC3, narrowed by customer clarification #91: the same people as
 * canViewRejection above, so the approval and the rejection of one request are
 * never visible to different sets of people.
 */
describe('canViewApproval', () => {
  const request = { organiserId: ORGANISER, coordinatorId: COORDINATOR_A };

  it('allows the organiser who owns the request', () => {
    expect(canViewApproval(request, { userId: ORGANISER, roles: ['event_organiser'] })).toBe(true);
  });

  it('allows the coordinator the request is assigned to', () => {
    expect(canViewApproval(request, { userId: COORDINATOR_A, roles: ['coordinator'] })).toBe(true);
  });

  it('refuses a coordinator the request is assigned away from', () => {
    expect(canViewApproval(request, { userId: COORDINATOR_B, roles: ['coordinator'] })).toBe(false);
  });

  // SCRUM-232 AC5: no longer open to any coordinator while unassigned - only
  // the Lead (coordinator_assignment, tested below) sees an unassigned event.
  it('refuses any coordinator while the request is not yet assigned', () => {
    expect(
      canViewApproval(
        { organiserId: ORGANISER, coordinatorId: null },
        { userId: COORDINATOR_B, roles: ['coordinator'] },
      ),
    ).toBe(false);
  });

  it('allows an Event Operations Manager, whichever coordinator it is assigned to', () => {
    expect(
      canViewApproval(request, { userId: OPS_MANAGER, roles: ['operations_manager'] }),
    ).toBe(true);
  });

  // SCRUM-232 AC5: the Lead's access does not depend on assignment existing
  // at all - they may read even an unassigned event's approval.
  it('allows an Event Operations Manager even while the request is unassigned', () => {
    expect(
      canViewApproval(
        { organiserId: ORGANISER, coordinatorId: null },
        { userId: OPS_MANAGER, roles: ['operations_manager'] },
      ),
    ).toBe(true);
  });

  // The bug as reported: any other signed-in account could read it by id.
  it('refuses an organiser who does not own the request, colleague or not', () => {
    expect(canViewApproval(request, { userId: STRANGER, roles: ['event_organiser'] })).toBe(false);
  });

  // Venue and equipment staff get a part in specific events once bookings and
  // reservations exist (later sprints); until then, their role alone is not a
  // relationship to this request.
  it('refuses venue staff and technical support, who have no part in this request yet', () => {
    expect(canViewApproval(request, { userId: STRANGER, roles: ['venue_staff'] })).toBe(false);
    expect(canViewApproval(request, { userId: STRANGER, roles: ['technical_support'] })).toBe(
      false,
    );
  });
});

/**
 * Both SCRUM-89 ACs describe opening a *submitted* request. A draft carries no
 * coordinator_id, so canReviewDetail alone read it as "unassigned, open to any
 * Coordinator" — which exposed every Organiser's unfinished draft through the
 * review route.
 */
describe('isReviewable', () => {
  it('refuses a draft, which has not been sent to anyone', () => {
    expect(isReviewable('draft')).toBe(false);
  });

  it.each(['submitted', 'clarification_requested', 'approved'] as const)(
    'allows %s, which has been submitted at least once',
    (status) => {
      expect(isReviewable(status)).toBe(true);
    },
  );
});

/**
 * US-7.2 AC1 ("visible to the Organiser") and AC3 ("anyone with access").
 * "With access" previously meant any signed-in account, which let anybody read
 * any request's note and status by id.
 */
describe('canViewClarification', () => {
  const ORGANISER = '33333333-3333-3333-3333-333333333333';
  const assigned = { organiserId: ORGANISER, coordinatorId: COORDINATOR_A };
  const unassigned = { organiserId: ORGANISER, coordinatorId: null };

  const as = (userId: string, extra: { isCoordinator?: boolean; isOperationsManager?: boolean } = {}) => ({
    userId,
    isCoordinator: extra.isCoordinator ?? false,
    isOperationsManager: extra.isOperationsManager ?? false,
  });

  it('allows the organiser the request belongs to', () => {
    expect(canViewClarification(assigned, as(ORGANISER))).toBe(true);
  });

  it('allows the coordinator it is assigned to', () => {
    expect(canViewClarification(assigned, as(COORDINATOR_A, { isCoordinator: true }))).toBe(true);
  });

  // SCRUM-96 AC4 — reassigned away means the note goes with the event.
  it('refuses a coordinator it is assigned away from', () => {
    expect(canViewClarification(assigned, as(COORDINATOR_B, { isCoordinator: true }))).toBe(false);
  });

  // SCRUM-232 AC5: no longer open to any coordinator while unassigned -
  // matching the narrowed review rule (canReviewDetail).
  it('refuses any coordinator while it is unassigned', () => {
    expect(canViewClarification(unassigned, as(COORDINATOR_B, { isCoordinator: true }))).toBe(false);
  });

  // Matches SCRUM-91's canViewClarificationExchange: the manager who decides
  // who owns the event may see the question hanging over it, even on a request
  // assigned to someone else.
  it('allows an Event Operations Manager', () => {
    expect(canViewClarification(assigned, as(COORDINATOR_B, { isOperationsManager: true }))).toBe(
      true,
    );
  });

  // SCRUM-232 AC5: the Lead's access does not depend on assignment existing
  // at all - they may read an unassigned event's clarification too.
  it('allows an Event Operations Manager even while the request is unassigned', () => {
    expect(canViewClarification(unassigned, as(COORDINATOR_B, { isOperationsManager: true }))).toBe(
      true,
    );
  });

  it('refuses a signed-in account that is none of the three', () => {
    expect(canViewClarification(unassigned, as(COORDINATOR_B))).toBe(false);
  });
});

/**
 * SCRUM-92 AC2/AC3, dummy D-02: the venue flag is derived from confirmed
 * bookings now that SCRUM-148 creates them. Equipment and registration stay
 * false until their stories land.
 */
describe('commitmentsFor and commitmentStatementFor (D-02, venue part)', () => {
  it('commits nothing, and says so, while the event holds no confirmed booking', () => {
    const commitments = commitmentsFor(false);
    expect(commitments).toEqual({ venue: false, equipment: false, registration: false });
    expect(commitmentStatementFor(commitments)).toBe('No venue, equipment or registration arrangement is yet committed.');
  });

  it('shows the venue as committed, and stops saying "no venue", once a booking is confirmed', () => {
    const commitments = commitmentsFor(true);
    expect(commitments).toEqual({ venue: true, equipment: false, registration: false });
    expect(commitmentStatementFor(commitments)).toBe(
      'A venue is booked. No equipment or registration arrangement is yet committed.',
    );
  });
});
