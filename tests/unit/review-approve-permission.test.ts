import { describe, it, expect } from 'vitest';
import { isActionPermitted } from '@/domain/identity/permissions';
import { assertPermission } from '@/domain/identity/policy';
import { ForbiddenError } from '@/domain/shared/errors';
import { canReviewDetail } from '@/domain/review/policy';

// SCRUM-92 AC1 — only an Event Coordinator may approve a request.
//
// That is the role half. The narrower per-event rule (US-7.3-TC04: a
// coordinator the request is assigned away from cannot approve it) is
// canReviewDetail, applied in approveEventRequest — see SCRUM-213 and the
// cases at the bottom of this file. The two are separate on purpose: holding
// the role is a question about the person, being this event's coordinator is a
// question about the event.

describe('event_request_approval permission', () => {
  it('is granted to a coordinator', () => {
    expect(isActionPermitted(['coordinator'], 'event_request_approval')).toBe(true);
    expect(() => assertPermission(['coordinator'], 'event_request_approval')).not.toThrow();
  });

  it.each([
    'event_organiser',
    'operations_manager',
    'venue_staff',
    'technical_support',
    'attendee',
  ] as const)('is refused to %s', (role) => {
    expect(isActionPermitted([role], 'event_request_approval')).toBe(false);
    expect(() => assertPermission([role], 'event_request_approval')).toThrow(ForbiddenError);
  });

  it('is refused to an account with no roles', () => {
    expect(() => assertPermission([], 'event_request_approval')).toThrow(ForbiddenError);
  });
});

/**
 * SCRUM-213 — holding the role is not enough. US-7.3-TC04: "Unassigned
 * Coordinator cannot approve/reject", with the precondition "Request assigned
 * to a different Coordinator".
 *
 * The rule itself is canReviewDetail, already covered in review-policy.test.ts
 * as SCRUM-89's read rule. These cases state what it means for approval, so the
 * bug has a test that names it, and so the unassigned decision below is
 * recorded rather than implied.
 */
describe('who may approve a particular event (SCRUM-213)', () => {
  const casey = 'casey-coordinator-id';
  const wei = 'wei-coordinator-id';

  it('allows the coordinator the event is assigned to', () => {
    expect(canReviewDetail(casey, casey)).toBe(true);
  });

  // The bug: Casey was assigned, then the event was reassigned to Wei.
  it('refuses a coordinator the event has been reassigned away from', () => {
    expect(canReviewDetail(wei, casey)).toBe(false);
  });

  it('refuses a coordinator who was never assigned it', () => {
    expect(canReviewDetail(wei, 'unrelated-coordinator-id')).toBe(false);
  });

  /**
   * Deliberate, not an oversight. SCRUM-92 AC1's precondition is "Given I am
   * reviewing a submitted request", and review access allows an event with no
   * coordinator yet. US-7.3-TC04 does not cover this case either - its
   * precondition is that the request IS assigned, to somebody else.
   *
   * Requiring assignment before approval would be a new user story.
   */
  it('allows any coordinator to approve an event with no coordinator yet', () => {
    expect(canReviewDetail(null, casey)).toBe(true);
  });
});
