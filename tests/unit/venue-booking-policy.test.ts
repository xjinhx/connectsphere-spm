import { describe, it, expect } from 'vitest';
import { canCreateBookingRequest } from '@/domain/venue-booking/policy';

/**
 * SCRUM-142 — Submit a venue booking request for an event (Jira,
 * authoritative).
 *
 * AC4 (the assigned-coordinator check) is not tested here: it reuses
 * isCurrentCoordinator directly (src/domain/assignment/policy.ts), already
 * covered by tests/unit/assignment-policy.test.ts and the SCRUM-93/96
 * precedents that established the same rule for reject/reassign.
 */
describe('canCreateBookingRequest', () => {
  // AC1 (Jira, updated 29/9/2026): "Given I am the assigned coordinator of
  // an event that is Approved or in Planning...".
  it.each(['approved', 'planning'] as const)(
    'allows a booking request on an event that is %s',
    (status) => {
      expect(canCreateBookingRequest(status)).toBe(true);
    },
  );

  // AC2: "Given an event has not been approved, when I attempt to create a
  // booking request, then the action is refused..."
  it.each(['draft', 'submitted', 'clarification_requested', 'rejected'] as const)(
    'refuses a booking request on an event that is %s',
    (status) => {
      expect(canCreateBookingRequest(status)).toBe(false);
    },
  );
});
