import { describe, it, expect } from 'vitest';
import { COMMITMENT_STATEMENT, NO_COMMITMENTS } from '@/domain/review/policy';

/**
 * SCRUM-92 — Approve a request so planning can proceed (US-7.3), AC2 and AC3.
 *
 * AC text is from the Jira card, which is authoritative.
 *
 * These assertions pass trivially this sprint: there is no Confirmed status and
 * no venue, equipment or registration record that could be committed. Flag
 * US-7.3-TC05 (commitment half) and US-7.3-TC06 for re-execution once Event
 * Status Management, Venue Booking, Equipment and Attendee Registration exist.
 *
 * The outcome and date reaching the caller is covered against a real database
 * in tests/integration/approval-view.test.ts.
 */

describe('what an approval commits ConnectSphere to', () => {
  // US-7.3-TC05 (AC2): "...together with a statement that no venue, equipment
  // or registration arrangement is yet committed."
  it('states that no venue, equipment or registration arrangement is yet committed', () => {
    expect(COMMITMENT_STATEMENT).toBe(
      'No venue, equipment or registration arrangement is yet committed.',
    );
  });

  // US-7.3-TC06 (AC3): "...no venue or equipment is shown as committed."
  it('shows no venue, equipment or registration as committed', () => {
    expect(NO_COMMITMENTS).toEqual({ venue: false, equipment: false, registration: false });
  });

  // The service hands out copies of this; a caller mutating one must not be
  // able to make every later view claim something is committed.
  it('cannot be changed in place', () => {
    expect(Object.isFrozen(NO_COMMITMENTS)).toBe(true);
  });
});
