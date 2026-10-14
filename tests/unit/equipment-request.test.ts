import { describe, expect, it } from 'vitest';
import { acceptsEquipmentRequest } from '@/domain/equipment-request/policy';
import { AddEquipmentLineInputSchema } from '@/domain/equipment-request/schema';
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
