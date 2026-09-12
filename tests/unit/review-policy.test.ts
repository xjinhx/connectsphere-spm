import { describe, it, expect } from 'vitest';
import { canBeApproved } from '@/domain/review/policy';

/**
 * SCRUM-92 — Approve a request so planning can proceed (US-7.3).
 *
 * AC text is from the Jira card, which is authoritative.
 *
 * Not coverable by a unit test - verify against the database or by hand:
 *   US-7.3-TC01 — the decision, decision maker and timestamp actually landing
 *        on the row, and no venue/equipment/registration record being created.
 *        The guard itself lives in the update statement, so only a test with a
 *        real database proves it.
 *   Two coordinators approving at once — the `.eq('status','SUBMITTED')` filter
 *        is what decides it; not reachable without a database.
 *   AC1 end to end — blocked on Authentication (getCurrentActor throws), so the
 *        approver's id is passed in for now.
 */

describe('canBeApproved', () => {
  // AC1: "Given I am reviewing a submitted request, when I approve it..."
  it('allows a submitted request to be approved', () => {
    expect(canBeApproved('SUBMITTED')).toBe(true);
  });

  it('refuses a draft, which has not been submitted for review yet', () => {
    expect(canBeApproved('DRAFT')).toBe(false);
  });

  // Negative coverage for approving from an invalid starting status: approving
  // twice is refused rather than silently re-stamping the first decision.
  it('refuses a request that is already approved', () => {
    expect(canBeApproved('APPROVED')).toBe(false);
  });
});
