import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '@/domain/shared/errors';
import { defaultRoleFor, RoleSchema } from '@/domain/identity/roles';
import {
  accountDisplay,
  assertCanWorkAs,
  isNavItemCurrent,
  landingPathFor,
  resolveWorkingRole,
} from '@/domain/navigation/policy';
import { ROLE_NAV } from '@/domain/navigation/roleNav';
import { NavItemSchema } from '@/domain/navigation/schema';

/**
 * SCRUM-249 Shared header — the pure rules behind it. The header itself is
 * tested by hand (TC-249-nn in the Sprint 4 test case sheet); these cover the
 * decisions it makes. Test case IDs match that sheet's SCRUM-249 tab.
 */

describe('SCRUM-249 AC1/AC3: "my landing page"', () => {
  it('TC-249-02 / TC-249-12: is the landing page of the role being worked as', () => {
    expect(landingPathFor('coordinator')).toBe('/assigned-events');
    expect(landingPathFor('technical_support')).toBe('/equipment-queue');
    expect(landingPathFor('venue_staff')).toBe('/booking-queue');
  });
});

describe('SCRUM-249 AC2: account menu name and email', () => {
  it('TC-249-08: a named account shows its name with the email under it', () => {
    expect(accountDisplay('Coordinator A', 'coordinator@example.com')).toEqual({
      primary: 'Coordinator A',
      secondary: 'coordinator@example.com',
    });
  });

  it('TC-249-09: an account with no name shows the email once', () => {
    expect(accountDisplay(null, 'coordinator-b@example.com')).toEqual({
      primary: 'coordinator-b@example.com',
      secondary: null,
    });
    expect(accountDisplay('   ', 'coordinator-b@example.com').secondary).toBeNull();
    expect(accountDisplay(undefined, 'coordinator-b@example.com').primary).toBe('coordinator-b@example.com');
  });
});

describe('SCRUM-249 AC4: which nav item is highlighted', () => {
  it('TC-249-15: the item for the page itself', () => {
    expect(isNavItemCurrent('/equipment', '/equipment')).toBe(true);
    expect(isNavItemCurrent('/equipment', '/equipment-queue')).toBe(false);
  });

  it('TC-249-16: nothing on a page with no nav item', () => {
    expect(isNavItemCurrent('/notifications', '/equipment-queue')).toBe(false);
  });

  it('TC-249-17: the parent item on every page under it', () => {
    expect(isNavItemCurrent('/venues/abc', '/venues')).toBe(true);
    expect(isNavItemCurrent('/venues/abc/calendar', '/venues')).toBe(true);
  });

  it('does not match on a shared prefix alone', () => {
    expect(isNavItemCurrent('/events-archive', '/events')).toBe(false);
    expect(isNavItemCurrent('/equipment-queue', '/equipment')).toBe(false);
  });
});

describe('SCRUM-249 AC5: Working as', () => {
  it('TC-249-18: a chosen role the account holds is the working role', () => {
    expect(resolveWorkingRole(['coordinator', 'venue_staff'], 'coordinator')).toBe('coordinator');
  });

  it('TC-249-21: with no choice, the working role is the default role', () => {
    expect(resolveWorkingRole(['coordinator', 'venue_staff'], undefined)).toBe('venue_staff');
    expect(defaultRoleFor(['coordinator', 'venue_staff'])).toBe('venue_staff');
  });

  it('TC-249-24: a stored choice the account does not hold is ignored', () => {
    expect(resolveWorkingRole(['coordinator', 'venue_staff'], 'technical_support')).toBe('venue_staff');
    expect(resolveWorkingRole(['coordinator'], 'not-a-role')).toBe('coordinator');
  });

  it('TC-249-24: switching to a role the account does not hold is refused', () => {
    expect(() => assertCanWorkAs(['coordinator', 'venue_staff'], 'technical_support')).toThrow(ForbiddenError);
    expect(() => assertCanWorkAs(['coordinator', 'venue_staff'], 'venue_staff')).not.toThrow();
  });
});

describe('SCRUM-249: ROLE_NAV', () => {
  it('has a valid entry for every role, starting with its landing page', () => {
    for (const role of RoleSchema.options) {
      const items = ROLE_NAV[role];
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) expect(NavItemSchema.safeParse(item).success).toBe(true);
      expect(items[0]?.href).toBe(landingPathFor(role));
    }
  });
});
