import { describe, it, expect } from 'vitest';
import { getPermittedActions, isActionPermitted } from '@/domain/identity/permissions';

// SCRUM-69

describe('getPermittedActions', () => {
  // AC1: matches the permission matrix entry for the role exactly
  it('returns exactly the matrix entry for a single-role account', () => {
    expect(getPermittedActions(['venue_staff'])).toEqual(
      expect.arrayContaining(['venue_administration', 'venue_catalogue_view']),
    );
    expect(getPermittedActions(['venue_staff'])).toHaveLength(2);
  });

  // AC2: Event Organiser never sees venue/equipment administration or coordinator assignment
  it('excludes venue administration, equipment administration and coordinator assignment for Event Organiser', () => {
    const actions = getPermittedActions(['event_organiser']);
    expect(actions).not.toContain('venue_administration');
    expect(actions).not.toContain('equipment_administration');
    expect(actions).not.toContain('coordinator_assignment');
    // SCRUM-185 AC2: their own event's registration list export.
    expect(actions).toEqual(['event_request_creation', 'registration_list_export']);
  });

  // SCRUM-181 gave the attendee its first action, so the attendee is now
  // checked against its matrix entry like any other role.
  it('returns exactly the matrix entry for the attendee', () => {
    expect(getPermittedActions(['attendee'])).toEqual(['event_registration']);
  });

  it('unions actions across multiple roles on one account, without duplicates', () => {
    const actions = getPermittedActions(['venue_staff', 'technical_support']);
    expect(actions).toEqual(
      expect.arrayContaining(['venue_administration', 'venue_catalogue_view', 'equipment_administration']),
    );
    expect(actions).toHaveLength(3);
  });
});

describe('isActionPermitted', () => {
  it('is true for an action the role is granted', () => {
    expect(isActionPermitted(['operations_manager'], 'coordinator_assignment')).toBe(true);
  });

  it('is false for an action assigned only to another role', () => {
    expect(isActionPermitted(['event_organiser'], 'coordinator_assignment')).toBe(false);
  });
});
