import { describe, it, expect } from 'vitest';
import { isActionPermitted } from '@/domain/identity/permissions';
import { assertPermission } from '@/domain/identity/policy';
import { ForbiddenError } from '@/domain/shared/errors';

// SCRUM-89 AC1 — only an Event Coordinator may review a submitted request.
// SCRUM-90 AC1 — only an Event Coordinator may request clarification.
// The narrower rule for both, only the coordinator assigned to the request
// (SCRUM-89 AC1/AC3), waits on SCRUM-94, same gap already documented for
// event_request_approval in review-approve-permission.test.ts.

describe('event_request_review permission', () => {
  it('is granted to a coordinator', () => {
    expect(isActionPermitted(['coordinator'], 'event_request_review')).toBe(true);
    expect(() => assertPermission(['coordinator'], 'event_request_review')).not.toThrow();
  });

  it.each([
    'event_organiser',
    'operations_manager',
    'venue_staff',
    'technical_support',
    'attendee',
  ] as const)('is refused to %s', (role) => {
    expect(isActionPermitted([role], 'event_request_review')).toBe(false);
    expect(() => assertPermission([role], 'event_request_review')).toThrow(ForbiddenError);
  });

  it('is refused to an account with no roles', () => {
    expect(() => assertPermission([], 'event_request_review')).toThrow(ForbiddenError);
  });
});

describe('event_request_clarification permission', () => {
  it('is granted to a coordinator', () => {
    expect(isActionPermitted(['coordinator'], 'event_request_clarification')).toBe(true);
    expect(() => assertPermission(['coordinator'], 'event_request_clarification')).not.toThrow();
  });

  it.each([
    'event_organiser',
    'operations_manager',
    'venue_staff',
    'technical_support',
    'attendee',
  ] as const)('is refused to %s', (role) => {
    expect(isActionPermitted([role], 'event_request_clarification')).toBe(false);
    expect(() => assertPermission([role], 'event_request_clarification')).toThrow(ForbiddenError);
  });

  it('is refused to an account with no roles', () => {
    expect(() => assertPermission([], 'event_request_clarification')).toThrow(ForbiddenError);
  });
});
