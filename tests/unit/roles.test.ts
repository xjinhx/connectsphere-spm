import { describe, it, expect } from 'vitest';
import { AccountRolesSchema, landingPathForRoles } from '@/domain/identity/roles';

describe('AccountRolesSchema', () => {
  it('accepts a valid single role', () => {
    const result = AccountRolesSchema.safeParse({
      accountId: '123e4567-e89b-12d3-a456-426614174000',
      roles: ['coordinator'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts multiple roles', () => {
    const result = AccountRolesSchema.safeParse({
      accountId: '123e4567-e89b-12d3-a456-426614174000',
      roles: ['coordinator', 'venue_staff'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown role value', () => {
    const result = AccountRolesSchema.safeParse({
      accountId: '123e4567-e89b-12d3-a456-426614174000',
      roles: ['made_up_role'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty roles array', () => {
    const result = AccountRolesSchema.safeParse({
      accountId: '123e4567-e89b-12d3-a456-426614174000',
      roles: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('landingPathForRoles', () => {
  it('maps each registered role to its landing page', () => {
    expect(landingPathForRoles(['event_organiser'])).toBe('/events');
    expect(landingPathForRoles(['coordinator'])).toBe('/assigned-events');
    expect(landingPathForRoles(['operations_manager'])).toBe('/assignment-queue');
    expect(landingPathForRoles(['venue_staff'])).toBe('/booking-queue');
    expect(landingPathForRoles(['technical_support'])).toBe('/equipment-queue');
    expect(landingPathForRoles(['attendee'])).toBe('/register-events');
  });

  it('uses the first recognised role when an account holds several', () => {
    expect(landingPathForRoles(['made-up-role', 'venue_staff'])).toBe('/booking-queue');
  });

  // SCRUM-232 AC1 — TC-232-03.
  it('sends a Lead who is also a Coordinator to the unassigned queue, whichever role is listed first', () => {
    expect(landingPathForRoles(['coordinator', 'operations_manager'])).toBe('/assignment-queue');
    expect(landingPathForRoles(['operations_manager', 'coordinator'])).toBe('/assignment-queue');
  });

  it('falls back to the Attendee landing page for an unrecognised role', () => {
    expect(landingPathForRoles(['made-up-role'])).toBe('/register-events');
  });

  it('falls back to the Attendee landing page when no roles are set', () => {
    expect(landingPathForRoles(undefined)).toBe('/register-events');
    expect(landingPathForRoles([])).toBe('/register-events');
  });
});
