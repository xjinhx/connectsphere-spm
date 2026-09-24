import { describe, it, expect } from 'vitest';
import {
  findLayoutsOverMaxCapacity,
  assertLayoutsWithinMaxCapacity,
  canManageVenues,
  canViewVenueCatalogue,
  isAffectedByCapacity,
  isCapacityCut,
} from '@/domain/venues/policy';
import { ValidationError } from '@/domain/shared/errors';
import type { Role } from '@/domain/identity/roles';
import type { VenueLayoutInput } from '@/domain/venues/schema';

/**
 * Venue Catalogue rules that compare values against each other, plus who may
 * do what. Single-field rules live in venues-schema.test.ts.
 *
 * Acceptance criteria are quoted from Jira. Test case IDs come from
 * ConnectSphere_Test_Cases_v3.
 */

describe('findLayoutsOverMaxCapacity: SCRUM-118 AC3 and AC4', () => {
  it('returns nothing when every layout fits', () => {
    const layouts: VenueLayoutInput[] = [
      { layout: 'theatre', capacity: 180 },
      { layout: 'banquet', capacity: 120 },
    ];
    expect(findLayoutsOverMaxCapacity(200, layouts)).toEqual([]);
  });

  it('returns only the layouts that are over the maximum', () => {
    const layouts: VenueLayoutInput[] = [
      { layout: 'theatre', capacity: 201 },
      { layout: 'banquet', capacity: 120 },
    ];
    expect(findLayoutsOverMaxCapacity(200, layouts)).toEqual([{ layout: 'theatre', capacity: 201 }]);
  });
});

describe('assertLayoutsWithinMaxCapacity: SCRUM-118 AC3 and AC4', () => {
  // US-11.2-TC02: a layout capacity above the venue maximum is rejected.
  // SCRUM-118 AC3 names 201 against a maximum of 200 exactly.
  it('US-11.2-TC02 rejects a layout capacity of 201 against a maximum of 200', () => {
    expect(() => assertLayoutsWithinMaxCapacity(200, [{ layout: 'theatre', capacity: 201 }])).toThrow(
      ValidationError,
    );
  });

  it('US-11.2-TC02 explains why the layout was rejected', () => {
    expect(() => assertLayoutsWithinMaxCapacity(200, [{ layout: 'theatre', capacity: 201 }])).toThrow(
      'Layout capacity cannot exceed the venue maximum.',
    );
  });

  // US-11.2-TC03: the boundary. SCRUM-118 AC4 names 200 against 200.
  it('US-11.2-TC03 accepts a layout capacity of 200 against a maximum of 200', () => {
    expect(() => assertLayoutsWithinMaxCapacity(200, [{ layout: 'theatre', capacity: 200 }])).not.toThrow();
  });

  it('accepts a venue with no layouts at all', () => {
    expect(() => assertLayoutsWithinMaxCapacity(200, [])).not.toThrow();
  });

  // SCRUM-120 AC1: the check runs against the values the venue will have after
  // an update, so lowering the maximum below an existing layout is refused.
  it('SCRUM-120 AC1 refuses lowering the maximum below an existing layout', () => {
    expect(() => assertLayoutsWithinMaxCapacity(150, [{ layout: 'theatre', capacity: 200 }])).toThrow(
      ValidationError,
    );
  });
});

describe('isCapacityCut: SCRUM-120 AC2', () => {
  // Only a lower maximum can put a booking over capacity, so only a cut asks.
  it('treats 100 lowered to 99 as a cut', () => {
    expect(isCapacityCut(100, 99)).toBe(true);
  });

  it('does not treat saving the same maximum as a cut', () => {
    expect(isCapacityCut(100, 100)).toBe(false);
  });

  it('does not treat raising the maximum as a cut', () => {
    expect(isCapacityCut(100, 120)).toBe(false);
  });
});

describe('isAffectedByCapacity: SCRUM-120 AC2 and AC3', () => {
  // AC2: "a confirmed future booking whose expected attendance is 100 and I set
  // the venue's maximum capacity to 99 ... that booking is shown to me"
  it('SCRUM-120 AC2 treats a booking of 100 as affected by a maximum of 99', () => {
    expect(isAffectedByCapacity(100, 99)).toBe(true);
  });

  // AC3: "... I set the venue's maximum capacity to 100 ... the change is
  // applied with no warning"
  it('SCRUM-120 AC3 does not treat a booking of 100 as affected by a maximum of 100', () => {
    expect(isAffectedByCapacity(100, 100)).toBe(false);
  });

  it('does not treat a booking with no expected attendance as affected', () => {
    expect(isAffectedByCapacity(null, 1)).toBe(false);
  });
});

describe('canManageVenues: SCRUM-116, 117, 118 and 120', () => {
  it('allows Venue Staff', () => {
    expect(canManageVenues(['venue_staff'])).toBe(true);
  });

  it('refuses a Coordinator', () => {
    expect(canManageVenues(['coordinator'])).toBe(false);
  });

  it('refuses an account with no roles', () => {
    const noRoles: Role[] = [];
    expect(canManageVenues(noRoles)).toBe(false);
  });

  it('allows an account that holds Venue Staff alongside another role', () => {
    expect(canManageVenues(['attendee', 'venue_staff'])).toBe(true);
  });
});

describe('canViewVenueCatalogue: SCRUM-121', () => {
  it('allows a Coordinator to browse the catalogue', () => {
    expect(canViewVenueCatalogue(['coordinator'])).toBe(true);
  });

  it.each<Role>(['coordinator', 'venue_staff', 'operations_manager', 'technical_support'])(
    'allows internal role %s',
    (role) => {
      expect(canViewVenueCatalogue([role])).toBe(true);
    },
  );

  // Team proposal: Release 1 stories only name Coordinators and Venue Staff,
  // so Event Organisers and Attendees are not given catalogue access.
  it.each<Role>(['event_organiser', 'attendee'])('refuses external role %s', (role) => {
    expect(canViewVenueCatalogue([role])).toBe(false);
  });
});
