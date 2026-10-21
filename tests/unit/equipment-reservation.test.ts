import { describe, expect, it } from 'vitest';
import { outstandingLines } from '@/domain/equipment-reservation/policy';
import { ReserveEquipmentInputSchema } from '@/domain/equipment-reservation/schema';

/**
 * SCRUM-173: the reservation rules on their own, in
 * src/domain/equipment-reservation/policy.ts and schema.ts. Against the
 * database, through the service, in
 * tests/integration/equipment-reservation.test.ts; the reserve route in
 * tests/unit/equipment-reservation-routes.test.ts.
 *
 * Test case IDs are from the B1 test case sheet (CL-46).
 */

describe('outstandingLines (173 AC7)', () => {
  it('TC-173-07: lists only what is still to reserve, with how many', () => {
    expect(
      outstandingLines([
        { lineId: 'a', equipmentName: 'EQ-173-07A', requested: 4, reserved: 4 },
        { lineId: 'b', equipmentName: 'EQ-173-07B', requested: 6, reserved: 4 },
      ]),
    ).toEqual([{ lineId: 'b', equipmentName: 'EQ-173-07B', requested: 6, reserved: 4, outstanding: 2 }]);
  });

  it('lists a line with nothing reserved in full', () => {
    expect(outstandingLines([{ lineId: 'a', equipmentName: 'Mic', requested: 3, reserved: 0 }])).toMatchObject([
      { outstanding: 3 },
    ]);
  });
});

describe('ReserveEquipmentInputSchema (173 AC1)', () => {
  it('takes a whole number of at least one', () => {
    expect(ReserveEquipmentInputSchema.safeParse({ quantity: 4 }).success).toBe(true);
  });

  it.each([0, -1, 2.5, '4', undefined])('refuses %s', (quantity) => {
    expect(ReserveEquipmentInputSchema.safeParse({ quantity }).success).toBe(false);
  });
});
