import { describe, it, expect } from 'vitest';
import {
  canRespondToClarification,
  canViewClarificationExchange,
  hasOpenRound,
  sortRoundsInOrder,
} from '@/domain/clarification/policy';
import { ClarificationResponseInputSchema } from '@/domain/clarification/schema';

/**
 * SCRUM-91 — Respond to a clarification request (US-7.2).
 *
 * The rules on their own, with no database. AC text is from the Jira card,
 * which is authoritative; the test case IDs are the sheet's numbering for the
 * bundled US-7.2 story (sheet AC4/AC5/AC6 = Jira AC1/AC2/AC3).
 */

describe('canRespondToClarification (Jira AC1)', () => {
  it('allows a request that is in Clarification Requested', () => {
    expect(canRespondToClarification('clarification_requested')).toBe(true);
  });

  // US-7.2-TC07 — there is nothing to answer on any other status.
  it.each(['draft', 'submitted', 'approved'] as const)('refuses a %s request', (status) => {
    expect(canRespondToClarification(status)).toBe(false);
  });
});

/**
 * SCRUM-232 AC5 (Week 7 Customer Changes PDF, change 5, confirmed with Arwen
 * 15 Oct 2026): canViewClarificationExchange used to include an event with no
 * coordinator yet ("matching SCRUM-89's canReviewDetail"); change 5 removes
 * that branch, same as canReviewDetail itself. This was flagged as one of the
 * assertions to update but had no existing test in this file to change -
 * added fresh rather than left uncovered.
 */
describe('canViewClarificationExchange (SCRUM-232 AC5)', () => {
  const organiserId = 'organiser-id';
  const coordinatorId = 'coordinator-id';

  it('refuses a coordinator when the event has no coordinator yet', () => {
    expect(
      canViewClarificationExchange(
        { organiserId, coordinatorId: null },
        { userId: coordinatorId, roles: ['coordinator'] },
      ),
    ).toBe(false);
  });

  it('still allows the assigned coordinator', () => {
    expect(
      canViewClarificationExchange(
        { organiserId, coordinatorId },
        { userId: coordinatorId, roles: ['coordinator'] },
      ),
    ).toBe(true);
  });

  it('still allows the Event Coordinator Lead to read an unassigned event', () => {
    expect(
      canViewClarificationExchange(
        { organiserId, coordinatorId: null },
        { userId: 'lead-id', roles: ['operations_manager'] },
      ),
    ).toBe(true);
  });

  it('still allows the organiser who owns the request', () => {
    expect(
      canViewClarificationExchange(
        { organiserId, coordinatorId: null },
        { userId: organiserId, roles: ['event_organiser'] },
      ),
    ).toBe(true);
  });
});

describe('hasOpenRound', () => {
  it('treats an unanswered round as open', () => {
    expect(hasOpenRound({ response: null })).toBe(true);
  });

  it('treats an answered round as closed', () => {
    expect(hasOpenRound({ response: 'Expected attendance is now 200' })).toBe(false);
  });

  it('treats no round at all as nothing to answer', () => {
    expect(hasOpenRound(null)).toBe(false);
  });
});

describe('sortRoundsInOrder (Jira AC3)', () => {
  // US-7.2-TC06 — "both rounds are listed in order", oldest first.
  it('puts the rounds oldest first whatever order they arrive in', () => {
    const sorted = sortRoundsInOrder([{ roundNumber: 2 }, { roundNumber: 1 }, { roundNumber: 3 }]);
    expect(sorted.map((r) => r.roundNumber)).toEqual([1, 2, 3]);
  });

  it('does not mutate what it was given', () => {
    const rounds = [{ roundNumber: 2 }, { roundNumber: 1 }];
    sortRoundsInOrder(rounds);
    expect(rounds.map((r) => r.roundNumber)).toEqual([2, 1]);
  });
});

describe('ClarificationResponseInputSchema (Jira AC1)', () => {
  it('accepts a response and trims it', () => {
    const parsed = ClarificationResponseInputSchema.safeParse({
      response: '  Expected attendance is now 200  ',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.response).toBe('Expected attendance is now 200');
  });

  // US-7.2-TC09 — a blank response is refused, and spaces are not a response.
  it.each(['', '   ', '\n\t'])('refuses %j', (response) => {
    const parsed = ClarificationResponseInputSchema.safeParse({ response });
    expect(parsed.success).toBe(false);
  });

  it('refuses a missing response', () => {
    expect(ClarificationResponseInputSchema.safeParse({}).success).toBe(false);
  });
});
