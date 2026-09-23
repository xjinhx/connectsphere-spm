import { describe, it, expect } from 'vitest';
import {
  canBeApproved,
  canBeRejected,
  canRequestClarification,
  canReviewDetail,
  canViewClarification,
  isAwaitingReview,
  isReviewable,
} from '@/domain/review/policy';

const COORDINATOR_A = '11111111-1111-1111-1111-111111111111';
const COORDINATOR_B = '22222222-2222-2222-2222-222222222222';

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

  // AC3 denies only when the request *is* assigned to someone else; it says
  // nothing about an unassigned one, so that stays open to any Coordinator.
  it('allows any coordinator while the request is not yet assigned', () => {
    expect(canReviewDetail(null, COORDINATOR_A)).toBe(true);
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

  it('allows any coordinator while it is unassigned, matching the review rule', () => {
    expect(canViewClarification(unassigned, as(COORDINATOR_B, { isCoordinator: true }))).toBe(true);
  });

  // Matches SCRUM-91's canViewClarificationExchange: the manager who decides
  // who owns the event may see the question hanging over it, even on a request
  // assigned to someone else.
  it('allows an Event Operations Manager', () => {
    expect(canViewClarification(assigned, as(COORDINATOR_B, { isOperationsManager: true }))).toBe(
      true,
    );
  });

  it('refuses a signed-in account that is none of the three', () => {
    expect(canViewClarification(unassigned, as(COORDINATOR_B))).toBe(false);
  });
});
