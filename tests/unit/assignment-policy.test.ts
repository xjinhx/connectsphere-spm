import { describe, it, expect } from 'vitest';
import {
  COORDINATOR_WORKLOAD_LIMIT,
  canBeAssigned,
  canReceiveAssignment,
  isActiveEventStatus,
  isAssigned,
} from '@/domain/assignment/policy';

/**
 * SCRUM-94 — Assign an Event Coordinator to a submitted event (US-7.4).
 *
 * AC text is from the Jira card, which is authoritative.
 */

describe('canBeAssigned', () => {
  // AC1: "an event has status Submitted and no assigned coordinator"
  it('allows a submitted event that nobody owns yet', () => {
    expect(canBeAssigned('submitted', null)).toBe(true);
  });

  it('refuses a submitted event that is already assigned', () => {
    expect(canBeAssigned('submitted', '11111111-1111-1111-1111-111111111111')).toBe(false);
  });

  it('refuses a draft: it has not been sent for review, so there is nothing to own', () => {
    expect(canBeAssigned('draft', null)).toBe(false);
  });

  it('refuses an approved event: assignment happens before review, not after', () => {
    expect(canBeAssigned('approved', null)).toBe(false);
  });
});

describe('isAssigned', () => {
  it('is false when no coordinator is recorded', () => {
    expect(isAssigned(null)).toBe(false);
  });

  it('is true once a coordinator is recorded', () => {
    expect(isAssigned('11111111-1111-1111-1111-111111111111')).toBe(true);
  });
});

describe('canReceiveAssignment', () => {
  it('accepts an Event Coordinator', () => {
    expect(canReceiveAssignment(['coordinator'])).toBe(true);
  });

  it('accepts an account holding the coordinator role among others', () => {
    expect(canReceiveAssignment(['venue_staff', 'coordinator'])).toBe(true);
  });

  it.each(['event_organiser', 'operations_manager', 'venue_staff', 'technical_support', 'attendee'] as const)(
    'refuses %s',
    (role) => {
      expect(canReceiveAssignment([role])).toBe(false);
    },
  );

  it('refuses an account with no roles', () => {
    expect(canReceiveAssignment([])).toBe(false);
  });
});

describe('isActiveEventStatus', () => {
  // SCRUM-233 AC2: "Given an event is Completed, Cancelled or Rejected, when
  // I open the overview, then it is not shown as active."
  it.each(['completed', 'cancelled', 'rejected'] as const)('excludes %s', (status) => {
    expect(isActiveEventStatus(status)).toBe(false);
  });

  it.each(['draft', 'submitted', 'planning', 'approved', 'clarification_requested'] as const)(
    'treats %s as active',
    (status) => {
      expect(isActiveEventStatus(status)).toBe(true);
    },
  );
});

describe('workload', () => {
  // AC2: a coordinator already holding three events takes a fourth, and the
  // assignment succeeds. Clarification #92 confirms there is no limit, so the
  // rule is that no rule applies.
  it('applies no workload limit', () => {
    expect(COORDINATOR_WORKLOAD_LIMIT).toBeNull();
  });
});
