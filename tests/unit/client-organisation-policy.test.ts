import { describe, it, expect } from 'vitest';
import { canManageClientOrganisations } from '@/domain/client-organisation/policy';
import type { Role } from '@/domain/identity/roles';

/**
 * SCRUM-203 — who may create and maintain a client organisation.
 * Acceptance criteria are quoted from Jira.
 */

describe('canManageClientOrganisations: SCRUM-203', () => {
  it('allows an Event Coordinator', () => {
    expect(canManageClientOrganisations(['coordinator'])).toBe(true);
  });

  it('allows an account that holds Coordinator alongside another role', () => {
    expect(canManageClientOrganisations(['attendee', 'coordinator'])).toBe(true);
  });

  it('refuses an account with no roles', () => {
    const noRoles: Role[] = [];
    expect(canManageClientOrganisations(noRoles)).toBe(false);
  });

  it.each<Role>(['event_organiser', 'venue_staff', 'operations_manager', 'technical_support', 'attendee'])(
    'refuses non-Coordinator role %s',
    (role) => {
      expect(canManageClientOrganisations([role])).toBe(false);
    },
  );
});
