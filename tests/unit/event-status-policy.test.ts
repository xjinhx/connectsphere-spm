import { describe, it, expect } from 'vitest';
import { canEnterPlanning } from '@/domain/event-status/policy';

/**
 * SCRUM-101 — Move an event through its statuses as work is done (Jira,
 * authoritative). AC1/AC2 (Draft -> Submitted, Submitted -> Approved) are
 * covered by existing tests, not here:
 *   - tests/unit/event-request-submit.test.ts, "lets a draft be submitted,
 *     and never a request that already is" (SCRUM-82's canBeSubmitted)
 *   - tests/unit/review-policy.test.ts, describe('canBeApproved') (SCRUM-92)
 *
 * This file covers AC3 and AC4, the ticket's actual new ground.
 */
describe('canEnterPlanning', () => {
  // AC3: "Given an event is Approved, when the first venue booking request is
  // raised against it, then the status becomes Planning." (narrowed from
  // "venue booking request or equipment request" — team decision.)
  it('allows an approved event to enter planning', () => {
    expect(canEnterPlanning('approved')).toBe(true);
  });

  // AC4: "Given an event is already in Planning, when a further venue booking
  // request is raised against it, then the status remains Planning." —
  // idempotent, not refused as a second/duplicate transition.
  it('allows an event already in planning to stay there', () => {
    expect(canEnterPlanning('planning')).toBe(true);
  });

  // Not explicitly asked by AC3/AC4 — refusing every other starting status is
  // SCRUM-103's ("Prevent invalid status transitions") surface, not this
  // ticket's. Kept here as a narrow sanity check that this function doesn't
  // claim more statuses can reach Planning than AC3 actually names.
  it('does not claim a draft event can reach planning', () => {
    expect(canEnterPlanning('draft')).toBe(false);
  });

  it('does not claim a submitted event can reach planning', () => {
    expect(canEnterPlanning('submitted')).toBe(false);
  });

  it('does not claim an event awaiting clarification can reach planning', () => {
    expect(canEnterPlanning('clarification_requested')).toBe(false);
  });

  it('does not claim a rejected event can reach planning', () => {
    expect(canEnterPlanning('rejected')).toBe(false);
  });
});
