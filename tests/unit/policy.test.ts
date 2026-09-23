import { describe, it, expect } from 'vitest';
import {
  hasRole,
  hasAnyRole,
  canAssignRoles,
  assertPermission,
  isAttendeeOnly,
} from '@/domain/identity/policy';
import type { Role } from '@/domain/identity/roles';


describe('hasRole', () => {
  it('returns true when the role is present', () => {
    expect(hasRole(['coordinator'], 'coordinator')).toBe(true);
  });

  it('returns false when the role was removed', () => {
    expect(hasRole(['venue_staff'], 'coordinator')).toBe(false);
  });

  // US-3.1-TC05: Removed role loses access on next action
  it('refuses access after Technical Support role is removed', () => {
    const rolesAfterRemoval: Role[] = [];
    expect(hasRole(rolesAfterRemoval, 'technical_support')).toBe(false);
  });
});

describe('hasAnyRole', () => {
  it('returns true if any required role matches', () => {
    expect(hasAnyRole(['attendee'], ['coordinator', 'attendee'])).toBe(true);
  });
});

describe('canAssignRoles', () => {
  // US-3.1-TC03: Roles are visible but read-only on own profile
  it('refuses when the actor tries to assign roles to themselves, even as admin', () => {
    const result = canAssignRoles(['operations_manager'], 'account-1', 'account-1');
    expect(result).toBe(false);
  });

  it('refuses when the actor is not an admin', () => {
    const result = canAssignRoles(['coordinator'], 'account-2', 'account-1');
    expect(result).toBe(false);
  });

  it('allows when the actor is an admin assigning roles to someone else', () => {
    const result = canAssignRoles(['operations_manager'], 'account-2', 'account-1');
    expect(result).toBe(true);
  });
});

// SCRUM-69 AC3: an action absent from the caller's permitted list is refused
describe('assertPermission', () => {
  it('does not throw when the role permits the action', () => {
    expect(() => assertPermission(['operations_manager'], 'account_role_management')).not.toThrow();
  });

  it('throws a ForbiddenError when the role does not permit the action', () => {
    expect(() => assertPermission(['event_organiser'], 'account_role_management')).toThrow(
      /does not permit/,
    );
  });
});

// SCRUM-72 AC2 / customer clarification #91: an Attendee-only account is
// denied internal planning data another story's card left open to "anyone".
describe('isAttendeeOnly', () => {
  it('is true for an account that holds only the Attendee role', () => {
    expect(isAttendeeOnly(['attendee'])).toBe(true);
  });

  it('is false for a non-Attendee role', () => {
    expect(isAttendeeOnly(['event_organiser'])).toBe(false);
  });

  it('is false when the account also holds a role with legitimate planning access', () => {
    expect(isAttendeeOnly(['attendee', 'coordinator'])).toBe(false);
  });

  it('is false for an account with no roles at all', () => {
    expect(isAttendeeOnly([])).toBe(false);
  });
});