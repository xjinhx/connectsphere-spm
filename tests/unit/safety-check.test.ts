import { describe, expect, it } from 'vitest';
import { holdsSafetyOfficerAndCoordinator } from '@/components/navigation/RolePagesBar';
import { canTransition, needsSafetyApproval } from '@/domain/event-status/policy';
import { isActionPermitted } from '@/domain/identity/permissions';
import { landingPathForRoles, type Role } from '@/domain/identity/roles';
import {
  STATUS_AFTER_DECISION,
  canRunSafetyCheck,
  canViewSafetyOutcome,
  isAwaitingSafetyCheck,
} from '@/domain/safety-check/policy';
import { REASON_REQUIRED_MESSAGE, RecordSafetyCheckInputSchema } from '@/domain/safety-check/schema';
import { EVENT_REQUEST_STATUS_DEFINITIONS, EVENT_REQUEST_STATUS_LABELS, EventRequestStatusEnum } from '@/domain/event-request/schema';

/**
 * SCRUM-234 Run the Operational Safety Check — the rules on their own. What
 * they do to stored events is tests/integration/safety-check.test.ts.
 *
 * AC text is from the Jira card (authoritative), as updated by Change Log
 * CL-27 (18 Oct): the old AC4 and AC5 are one criterion, AC4, and the old AC6
 * and AC7 are now AC5 and AC6. Test case IDs are from the SCRUM-234 tab of
 * Team_Owned_ScrumsTest.xlsx (TC-234-nn).
 */

const OTHER_ROLES: Role[] = [
  'event_organiser',
  'coordinator',
  'operations_manager',
  'venue_staff',
  'technical_support',
  'attendee',
];

describe('AC1 — the Safety Officer lands on the Confirmed events awaiting a check', () => {
  it('TC-234-01: the Safety Officer lands on the safety check list', () => {
    expect(landingPathForRoles(['safety_officer'])).toBe('/safety-checks');
  });

  it('TC-234-03: an account holding the role with another lands on the list wherever it sits', () => {
    expect(landingPathForRoles(['coordinator', 'safety_officer'])).toBe('/safety-checks');
  });

  it('SCRUM-232 AC1 is unchanged: an account that is also the Lead keeps the Lead landing page', () => {
    expect(landingPathForRoles(['safety_officer', 'operations_manager'])).toBe('/assignment-queue');
  });

  it('TC-234-02: only a Confirmed event is awaiting a check', () => {
    const awaiting = EventRequestStatusEnum.options.filter(isAwaitingSafetyCheck);
    expect(awaiting).toEqual(['confirmed']);
  });
});

describe('AC3, AC4 — where each decision sends the event', () => {
  it('TC-234-08: approving moves it to Preparation', () => {
    expect(STATUS_AFTER_DECISION.approved).toBe('preparation');
  });

  it('TC-234-10: requesting changes returns it to Planning', () => {
    expect(STATUS_AFTER_DECISION.changes_requested).toBe('planning');
  });

  it('TC-234-11: rejecting returns it to Planning, not Cancelled (#130)', () => {
    expect(STATUS_AFTER_DECISION.rejected).toBe('planning');
  });

  it('every move a decision makes is in the lifecycle table', () => {
    for (const to of Object.values(STATUS_AFTER_DECISION)) expect(canTransition('confirmed', to)).toBe(true);
  });
});

describe('AC3, AC4 — the decision input', () => {
  it('TC-234-08: an approval needs no reason, and any reason sent with it is dropped', () => {
    expect(RecordSafetyCheckInputSchema.parse({ decision: 'approved' })).toEqual({ decision: 'approved', note: null });
    expect(RecordSafetyCheckInputSchema.parse({ decision: 'approved', note: 'fine' })).toEqual({
      decision: 'approved',
      note: null,
    });
  });

  it('TC-234-10/11: the reason is kept, trimmed, for both decisions', () => {
    expect(
      RecordSafetyCheckInputSchema.parse({ decision: 'changes_requested', note: '  Add a second fire marshal  ' }),
    ).toEqual({ decision: 'changes_requested', note: 'Add a second fire marshal' });
    expect(RecordSafetyCheckInputSchema.parse({ decision: 'rejected', note: 'Exit blocked' })).toEqual({
      decision: 'rejected',
      note: 'Exit blocked',
    });
  });

  it('TC-234-12: request changes without a reason is refused, naming the reason', () => {
    const result = RecordSafetyCheckInputSchema.safeParse({ decision: 'changes_requested', note: '' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ['note'], message: REASON_REQUIRED_MESSAGE });
  });

  it('TC-234-12: reject with a reason of only spaces is refused, naming the reason', () => {
    const result = RecordSafetyCheckInputSchema.safeParse({ decision: 'rejected', note: '   ' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ['note'], message: REASON_REQUIRED_MESSAGE });
  });

  it('refuses an unknown decision and a note over 1000 characters', () => {
    expect(RecordSafetyCheckInputSchema.safeParse({ decision: 'maybe' }).success).toBe(false);
    expect(RecordSafetyCheckInputSchema.safeParse({ decision: 'rejected', note: 'x'.repeat(1001) }).success).toBe(false);
  });
});

describe('AC5 — no move to Preparation without the Safety Officer', () => {
  it('TC-234-13/14: a move into Preparation always needs the safety approval', () => {
    expect(needsSafetyApproval('preparation')).toBe(true);
    for (const to of EventRequestStatusEnum.options.filter((s) => s !== 'preparation')) {
      expect(needsSafetyApproval(to)).toBe(false);
    }
  });

  it('only Confirmed leads to Preparation', () => {
    const from = EventRequestStatusEnum.options.filter((s) => canTransition(s, 'preparation'));
    expect(from).toEqual(['confirmed']);
  });

  it('TC-234-15: Preparation -> Completed and Preparation -> Cancelled are allowed, nothing else', () => {
    expect(canTransition('preparation', 'completed')).toBe(true);
    expect(canTransition('preparation', 'cancelled')).toBe(true);
    expect(EventRequestStatusEnum.options.filter((s) => canTransition('preparation', s))).toEqual([
      'completed',
      'cancelled',
    ]);
  });
});

describe('AC6 — only the Safety Officer decides', () => {
  it('TC-234-16/18: the Safety Officer may run the check, no other role may', () => {
    expect(canRunSafetyCheck(['safety_officer'])).toBe(true);
    expect(isActionPermitted(['safety_officer'], 'safety_check')).toBe(true);
    for (const role of OTHER_ROLES) expect(canRunSafetyCheck([role])).toBe(false);
  });

  it('AC4: the reason is shown to the assigned coordinator and the Safety Officer only', () => {
    const event = { coordinator_id: 'coord-1' };
    expect(canViewSafetyOutcome({ userId: 'coord-1', roles: ['coordinator'] }, event)).toBe(true);
    expect(canViewSafetyOutcome({ userId: 'coord-2', roles: ['coordinator'] }, event)).toBe(false);
    expect(canViewSafetyOutcome({ userId: 'so-1', roles: ['safety_officer'] }, event)).toBe(true);
    expect(canViewSafetyOutcome({ userId: 'lead', roles: ['operations_manager'] }, event)).toBe(false);
  });
});

describe('AC3 — Preparation as the event page shows it (card notes, for SCRUM-99)', () => {
  it('TC-234-19: Preparation has the card\'s one-line definition', () => {
    expect(EVENT_REQUEST_STATUS_LABELS.preparation).toBe('Preparation');
    expect(EVENT_REQUEST_STATUS_DEFINITIONS.preparation).toBe('Passed its safety check and being prepared for the day.');
  });
});

describe('AC1 — an account that is also a Coordinator can reach its other pages', () => {
  it('TC-234-03: the page bar is shown only to an account holding both roles', () => {
    expect(holdsSafetyOfficerAndCoordinator(['coordinator', 'safety_officer'])).toBe(true);
    expect(holdsSafetyOfficerAndCoordinator(['safety_officer'])).toBe(false);
    expect(holdsSafetyOfficerAndCoordinator(['coordinator'])).toBe(false);
    expect(holdsSafetyOfficerAndCoordinator(['operations_manager', 'safety_officer'])).toBe(false);
  });
});
