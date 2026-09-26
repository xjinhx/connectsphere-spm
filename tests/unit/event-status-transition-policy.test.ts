import { describe, it, expect } from 'vitest';
import { ALLOWED_TRANSITIONS, canTransition } from '@/domain/event-status/policy';
import { EventRequestStatusEnum } from '@/domain/event-request/schema';

/**
 * SCRUM-103 — Prevent invalid status transitions.
 *
 * AC text is from the Jira card, which is authoritative. Test case numbers are
 * this story's own (Sprint 2: one tab per story, T1, T2...).
 *
 * These test the rule. "The status is unchanged" is about the stored row, so
 * that half of each AC is in tests/integration/event-status-transitions.test.ts.
 */

describe('SCRUM-103 AC1 — Draft cannot jump to Confirmed', () => {
  it('T1: refuses draft -> confirmed', () => {
    expect(canTransition('draft', 'confirmed')).toBe(false);
  });
});

describe('SCRUM-103 AC2 — Rejected cannot become Approved', () => {
  it('T2: refuses rejected -> approved', () => {
    expect(canTransition('rejected', 'approved')).toBe(false);
  });
});

describe('SCRUM-103 AC3 — Cancelled is final', () => {
  // The six statuses the card lists, one test each so a failure names the move.
  it.each(['draft', 'submitted', 'approved', 'planning', 'confirmed', 'completed'] as const)(
    'T3: refuses cancelled -> %s',
    (to) => {
      expect(canTransition('cancelled', to)).toBe(false);
    },
  );
});

describe('SCRUM-103 AC4 — Confirmed may go back to Planning', () => {
  it('T4: allows confirmed -> planning', () => {
    expect(canTransition('confirmed', 'planning')).toBe(true);
  });
});

describe('SCRUM-103 — the table itself', () => {
  it('lists a row for every status, so no status is silently unguarded', () => {
    expect(Object.keys(ALLOWED_TRANSITIONS).sort()).toEqual([...EventRequestStatusEnum.options].sort());
  });

  it('never lists a status moving to itself', () => {
    for (const status of EventRequestStatusEnum.options) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  // The Sprint 1 actions must stay legal, or this story would break them.
  it.each([
    ['draft', 'submitted'],
    ['submitted', 'approved'],
    ['submitted', 'rejected'],
    ['submitted', 'clarification_requested'],
    ['clarification_requested', 'submitted'],
  ] as const)('still allows %s -> %s, which a Sprint 1 action makes', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });
});
