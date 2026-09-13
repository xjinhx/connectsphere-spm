import { describe, it, expect } from 'vitest';
import { isActionPermitted } from '@/domain/identity/permissions';
import { assertPermission } from '@/domain/identity/policy';
import { ForbiddenError } from '@/domain/shared/errors';

// SCRUM-92 AC1 — only an Event Coordinator may approve a request.
// The narrower rule, only the coordinator assigned to the request
// (US-7.3-TC04), waits on SCRUM-94.

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
