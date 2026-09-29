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
  // an event that is Approved or in Planning...". Only the Approved half is
  // testable here — 'planning' isn't a valid EventRequestStatus on this
  // branch until SCRUM-101 merges to main, so it can't even be typed into a
  // test yet, let alone passed. See the note on canCreateBookingRequest
  // itself (policy.ts) for what changes once that lands.
  it('allows a booking request on an approved event', () => {
    expect(canCreateBookingRequest('approved')).toBe(true);
  });

  // AC2: "Given an event has not been approved, when I attempt to create a
  // booking request, then the action is refused..."
  it.each(['draft', 'submitted', 'clarification_requested', 'rejected'] as const)(
    'refuses a booking request on an event that is %s',
    (status) => {
      expect(canCreateBookingRequest(status)).toBe(false);
    },
  );
});
