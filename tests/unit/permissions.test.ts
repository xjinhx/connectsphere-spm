import { describe, it, expect } from 'vitest';
import { getPermittedActions, isActionPermitted } from '@/domain/identity/permissions';

// SCRUM-69

describe('getPermittedActions', () => {
  // AC1: matches the permission matrix entry for the role exactly
  it('returns exactly the matrix entry for a single-role account', () => {
    expect(getPermittedActions(['venue_staff'])).toEqual(
      expect.arrayContaining(['venue_administration', 'venue_catalogue_view', 'venue_booking_review']),
    );
    expect(getPermittedActions(['venue_staff'])).toHaveLength(3);
  });

  // AC2: Event Organiser never sees venue/equipment administration or coordinator assignment
  it('excludes venue administration, equipment administration and coordinator assignment for Event Organiser', () => {
    const actions = getPermittedActions(['event_organiser']);
    expect(actions).not.toContain('venue_administration');
    expect(actions).not.toContain('equipment_administration');
    expect(actions).not.toContain('coordinator_assignment');
    expect(actions).toEqual(['event_request_creation']);
  });

  it('returns no actions for a role granted none', () => {
    expect(getPermittedActions(['attendee'])).toEqual([]);
  });

  it('unions actions across multiple roles on one account, without duplicates', () => {
    const actions = getPermittedActions(['venue_staff', 'technical_support']);
    expect(actions).toEqual(
      expect.arrayContaining([
        'venue_administration',
        'venue_catalogue_view',
        'venue_booking_review',
        'equipment_administration',
      ]),
    );
    expect(actions).toHaveLength(4);
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
