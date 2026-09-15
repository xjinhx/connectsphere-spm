import { describe, it, expect } from 'vitest';
import { canBeApproved, canRequestClarification, isAwaitingReview } from '@/domain/review/policy';

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
