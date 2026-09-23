import { describe, it, expect } from 'vitest';
import { AssignOrganisationInputSchema, AccountOrganisationSchema } from '@/domain/identity/schema';
import { canAssignOrganisation } from '@/domain/identity/policy';
import { isActionPermitted } from '@/domain/identity/permissions';

// SCRUM-204 AC1 — an Event Organiser account can be linked to exactly one
// client organisation, and the assignment is only meaningful for that role.

describe('AssignOrganisationInputSchema', () => {
  it('accepts a valid organisation id', () => {
    const result = AssignOrganisationInputSchema.safeParse({
      clientOrganisationId: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(result.success).toBe(true);
  });

  it('accepts null, to clear the membership', () => {
    const result = AssignOrganisationInputSchema.safeParse({ clientOrganisationId: null });
    expect(result.success).toBe(true);
  });

  it('rejects a non-uuid value', () => {
    const result = AssignOrganisationInputSchema.safeParse({ clientOrganisationId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });
});

describe('AccountOrganisationSchema', () => {
  it('accepts an account with no organisation', () => {
    const result = AccountOrganisationSchema.safeParse({
      accountId: '123e4567-e89b-12d3-a456-426614174000',
      clientOrganisationId: null,
    });
    expect(result.success).toBe(true);
  });
});

describe('canAssignOrganisation', () => {
  it('allows a target account that holds the Event Organiser role', () => {
    expect(canAssignOrganisation(['event_organiser'])).toBe(true);
  });

  it('refuses a target account that does not hold the Event Organiser role', () => {
    expect(canAssignOrganisation(['coordinator'])).toBe(false);
  });

  it('refuses an account with no roles at all', () => {
    expect(canAssignOrganisation([])).toBe(false);
  });
});

describe('organisation_membership_management permission', () => {
  it('is granted to an Event Coordinator', () => {
    expect(isActionPermitted(['coordinator'], 'organisation_membership_management')).toBe(true);
  });

  it('is not granted to an Event Organiser', () => {
    expect(isActionPermitted(['event_organiser'], 'organisation_membership_management')).toBe(false);
  });

  it('is not granted to an Operations Manager', () => {
    // account_role_management is theirs; organisation membership stays with
    // the Coordinator persona this story is written for.
    expect(isActionPermitted(['operations_manager'], 'organisation_membership_management')).toBe(false);
  });
});
