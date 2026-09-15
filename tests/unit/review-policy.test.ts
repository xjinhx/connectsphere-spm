import { describe, it, expect } from 'vitest';
import {
  canBeApproved,
  canRequestClarification,
  canReviewDetail,
  isAwaitingReview,
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
 * SCRUM-89 AC3 — "a request assigned to another Event Coordinator ... access
 * is denied." Not coverable by a unit test: the row actually carrying
 * coordinator_id, and getReviewDetail wiring this rule to a real fetch, need
 * a database — see the note left in docs/SCRUM-89-90-summary.md.
 */
describe('canReviewDetail', () => {
  it('allows the assigned coordinator', () => {
    expect(canReviewDetail(COORDINATOR_A, COORDINATOR_A)).toBe(true);
  });

  it('refuses a coordinator the request is not assigned to', () => {
    expect(canReviewDetail(COORDINATOR_A, COORDINATOR_B)).toBe(false);
  });

  it('allows any coordinator while the request is not yet assigned', () => {
    expect(canReviewDetail(null, COORDINATOR_A)).toBe(true);
  });
});
