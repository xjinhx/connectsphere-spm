import { describe, expect, it } from 'vitest';
import { acceptsEquipmentRequest } from '@/domain/equipment-request/policy';
import { AddEquipmentLineInputSchema, UpdateEquipmentLineInputSchema } from '@/domain/equipment-request/schema';
import { EventRequestStatusEnum, type EventRequestStatus } from '@/domain/event-request/schema';

/**
 * SCRUM-160 Record the equipment an event needs: the rules on their own, with
 * no database. What the rules do to stored rows is in
 * tests/integration/equipment-request.test.ts.
 *
 * Test case IDs are from the Sprint 3 sheet's SCRUM-160 tab (TC-160-nn).
 */

const PROJECTOR = '11111111-1111-4111-8111-111111111111';

function fieldErrors(input: unknown) {
  const parsed = AddEquipmentLineInputSchema.safeParse(input);
  return parsed.success ? {} : parsed.error.flatten().fieldErrors;
}

describe('AC1: which events accept an equipment request', () => {
  it('accepts Approved and Planning events', () => {
    expect(acceptsEquipmentRequest('approved')).toBe(true);
    expect(acceptsEquipmentRequest('planning')).toBe(true);
  });

  it('TC-160-02 refuses every other status, Completed and Cancelled included', () => {
    const others = EventRequestStatusEnum.options.filter(
      (status): status is EventRequestStatus => status !== 'approved' && status !== 'planning',
    );
    expect(others).toContain('completed');
    expect(others).toContain('cancelled');
    for (const status of others) expect(acceptsEquipmentRequest(status)).toBe(false);
  });
});

describe('AC1: an item needs an equipment type and a quantity', () => {
  it('TC-160-01 accepts a catalogue item id with a quantity', () => {
    expect(AddEquipmentLineInputSchema.safeParse({ equipmentId: PROJECTOR, quantity: 2 }).success).toBe(true);
  });

  it('TC-160-03 refuses a missing equipment type and names the field', () => {
    expect(fieldErrors({ quantity: 2 })).toEqual({ equipmentId: ['Choose an equipment type.'] });
    expect(fieldErrors({ equipmentId: '', quantity: 2 })).toEqual({ equipmentId: ['Choose an equipment type.'] });
  });

  it('names both fields when both are missing', () => {
    expect(Object.keys(fieldErrors({})).sort()).toEqual(['equipmentId', 'quantity']);
  });

  it('refuses a quantity that is not a whole number', () => {
    expect(fieldErrors({ equipmentId: PROJECTOR, quantity: 2.5 })).toEqual({
      quantity: ['Quantity must be a whole number.'],
    });
  });
});

describe('AC2: the quantity must be at least one', () => {
  it('TC-160-04 refuses 0 with the "at least one" message on the quantity field', () => {
    expect(fieldErrors({ equipmentId: PROJECTOR, quantity: 0 })).toEqual({
      quantity: ['Quantity must be at least one.'],
    });
  });

  it('refuses a negative quantity with the same message', () => {
    expect(fieldErrors({ equipmentId: PROJECTOR, quantity: -3 })).toEqual({
      quantity: ['Quantity must be at least one.'],
    });
  });

  it('TC-160-05 accepts 1, one step above the refusal', () => {
    expect(AddEquipmentLineInputSchema.safeParse({ equipmentId: PROJECTOR, quantity: 1 }).success).toBe(true);
  });

  it('TC-160-06 holds when a line is changed to 0, not only when it is added', () => {
    const parsed = UpdateEquipmentLineInputSchema.safeParse({ quantity: 0 });
    expect(parsed.success).toBe(false);
    expect(parsed.success ? null : parsed.error.flatten().fieldErrors).toEqual({
      quantity: ['Quantity must be at least one.'],
    });
  });
});
