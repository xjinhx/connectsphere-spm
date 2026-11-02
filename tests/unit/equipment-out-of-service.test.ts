import { describe, expect, it } from 'vitest';
import { availableUnits } from '@/domain/equipment-reservation/policy';
import {
  countsOverQuantity,
  describeOutOfService,
  outOfServiceTotal,
  unitsInService,
} from '@/domain/equipment-out-of-service/policy';
import { NO_UNITS_OUT_OF_SERVICE, OutOfServiceCountsSchema } from '@/domain/equipment-out-of-service/schema';

/**
 * SCRUM-170 Exclude equipment that is unavailable, damaged or under
 * maintenance: the rules on their own, in
 * src/domain/equipment-out-of-service/policy.ts and schema.ts. Against the
 * database, through the service, in
 * tests/integration/equipment-out-of-service.test.ts.
 *
 * Test case IDs are from the B1 test case sheet (CL-46).
 */

const counts = (unavailable: number, damaged: number, underMaintenance: number) => ({
  unavailable,
  damaged,
  underMaintenance,
});

describe('OutOfServiceCountsSchema (AC1, AC4)', () => {
  it('takes a whole number of units, from zero, for each status', () => {
    expect(OutOfServiceCountsSchema.safeParse(counts(2, 0, 0)).success).toBe(true);
    expect(OutOfServiceCountsSchema.safeParse(counts(0, 0, 0)).success).toBe(true);
  });

  it('TC-170-11 (AC4): refuses fewer than zero and names the field', () => {
    const result = OutOfServiceCountsSchema.safeParse(counts(0, -1, 0));
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors).toEqual({ damaged: ['Units out of service cannot be below zero.'] });
  });

  it('refuses a number that is not whole, naming the field', () => {
    const result = OutOfServiceCountsSchema.safeParse(counts(1.5, 0, 0));
    expect(result.error?.flatten().fieldErrors).toEqual({ unavailable: ['Units must be a whole number.'] });
  });
});

describe('countsOverQuantity (AC4)', () => {
  it('TC-170-06: 11 of 10 recorded as Damaged is refused on the Damaged field', () => {
    expect(countsOverQuantity(10, counts(0, 11, 0), NO_UNITS_OUT_OF_SERVICE)).toEqual({
      damaged: ['This item has 10 units, so no more than 10 can be out of service in all.'],
    });
  });

  it('TC-170-07: exactly as many as exist is accepted', () => {
    expect(countsOverQuantity(10, counts(0, 0, 10), NO_UNITS_OUT_OF_SERVICE)).toBeNull();
  });

  it('TC-170-08: the limit is on the total; 8 Damaged then 3 Under maintenance is refused on the field that changed', () => {
    expect(countsOverQuantity(10, counts(0, 8, 3), counts(0, 8, 0))).toEqual({
      underMaintenance: ['This item has 10 units, so no more than 10 can be out of service in all.'],
    });
  });
});

describe('unitsInService (AC1, AC3, AC5)', () => {
  const item = (operationalStatus: 'available' | 'unavailable' | 'damaged' | 'under_maintenance', c = NO_UNITS_OUT_OF_SERVICE) => ({
    quantity: 10,
    operationalStatus,
    counts: c,
  });

  it.each([
    ['TC-170-01', counts(2, 0, 0)],
    ['TC-170-02', counts(0, 2, 0)],
    ['TC-170-03', counts(0, 0, 2)],
  ])('%s (AC1): 2 units out of service leave 8, whatever the status', (_tc, c) => {
    expect(unitsInService(item('available', c))).toBe(8);
  });

  it('TC-170-04 (AC2): a unit returned to service counts again', () => {
    expect(unitsInService(item('available', counts(0, 1, 0)))).toBe(9);
  });

  it.each(['damaged', 'unavailable', 'under_maintenance'] as const)(
    'TC-170-09 (AC5): an item whose own status is %s has none in service',
    (status) => {
      expect(unitsInService(item(status))).toBe(0);
    },
  );

  it('TC-170-07: all 10 out of service leaves 0', () => {
    expect(unitsInService(item('available', counts(0, 0, 10)))).toBe(0);
  });
});

describe('availableUnits with units out of service (AC6)', () => {
  it('TC-170-10: 10 units, 5 Damaged, 6 held by another event: 0, never -1', () => {
    expect(availableUnits(unitsInService({ quantity: 10, operationalStatus: 'available', counts: counts(0, 5, 0) }), 6)).toBe(0);
  });
});

describe('outOfServiceTotal and describeOutOfService (AC1)', () => {
  it('adds the three statuses', () => {
    expect(outOfServiceTotal(counts(1, 2, 3))).toBe(6);
  });

  it('shows each status with its count, and nothing when none are out', () => {
    expect(describeOutOfService(counts(2, 0, 1))).toBe('2 Unavailable, 1 Under maintenance');
    expect(describeOutOfService(NO_UNITS_OUT_OF_SERVICE)).toBeNull();
  });
});
