import { describe, it, expect } from 'vitest';
import {
  canBeApproved,
  canBeRejected,
  canRequestClarification,
  canReviewDetail,
  canViewRejection,
  isAwaitingReview,
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

  // AC3 denies only when the request *is* assigned to someone else; it says
  // nothing about an unassigned one, so that stays open to any Coordinator.
  it('allows any coordinator while the request is not yet assigned', () => {
    expect(canReviewDetail(null, COORDINATOR_A)).toBe(true);
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

  it('allows any coordinator while the request is not yet assigned', () => {
    expect(
      canViewRejection(
        { organiserId: ORGANISER, coordinatorId: null },
        { userId: COORDINATOR_B, roles: ['coordinator'] },
      ),
    ).toBe(true);
  });

  it('allows an Event Operations Manager, whichever coordinator it is assigned to', () => {
    expect(
      canViewRejection(request, { userId: OPS_MANAGER, roles: ['operations_manager'] }),
    ).toBe(true);
  });

  it('refuses a signed-in stranger with no role or relationship to the request', () => {
    expect(canViewRejection(request, { userId: STRANGER, roles: ['attendee'] })).toBe(false);
  });
});
