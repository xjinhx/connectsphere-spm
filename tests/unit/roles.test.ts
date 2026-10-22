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

  it('ignores an unrecognised role and uses the recognised one', () => {
    expect(landingPathForRoles(['made-up-role', 'venue_staff'])).toBe('/booking-queue');
  });

  // SCRUM-249 — the default role follows one fixed order, not the order roles
  // are stored in (PO, 22 Oct 2026). Test case IDs from the Sprint 4 sheet.
  it('TC-249-14: lands by the fixed role order, whatever the stored order', () => {
    expect(landingPathForRoles(['coordinator', 'technical_support'])).toBe('/equipment-queue');
    expect(landingPathForRoles(['technical_support', 'coordinator'])).toBe('/equipment-queue');
    expect(landingPathForRoles(['coordinator', 'venue_staff'])).toBe('/booking-queue');
    expect(landingPathForRoles(['event_organiser', 'coordinator'])).toBe('/assigned-events');
    expect(landingPathForRoles(['attendee', 'event_organiser'])).toBe('/events');
  });

  it('TC-254-04: Technical Support Staff stored second still lands on the equipment queue', () => {
    expect(landingPathForRoles(['coordinator', 'technical_support'])).toBe('/equipment-queue');
  });

  it('TC-254-05: a Lead who is also Technical Support Staff lands on the Lead page', () => {
    expect(landingPathForRoles(['technical_support', 'operations_manager'])).toBe('/assignment-queue');
  });

  it('a Safety Officer who is also Technical Support Staff lands on the safety checks', () => {
    expect(landingPathForRoles(['technical_support', 'safety_officer'])).toBe('/safety-checks');
  });

  // SCRUM-232 AC1 — test case IDs from the SCRUM-232 tab of ConnectSphere_TestCases_Sprint3.xlsx.
  it('TC-232-01: Lead lands on the unassigned queue at login', () => {
    expect(landingPathForRoles(['operations_manager'])).toBe('/assignment-queue');
  });

  it('TC-232-02: A Coordinator does not land on the unassigned queue', () => {
    expect(landingPathForRoles(['coordinator'])).toBe('/assigned-events');
  });

  it('TC-232-03: Lead who also holds the Coordinator role still lands on the queue', () => {
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
