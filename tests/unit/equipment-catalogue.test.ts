import { describe, it, expect } from 'vitest';
import {
  CreateEquipmentInputSchema,
  DEFAULT_OPERATIONAL_STATUS,
  EQUIPMENT_CATEGORIES,
  EquipmentOptionSchema,
  OPERATIONAL_STATUSES,
  OPERATIONAL_STATUS_LABELS,
  UpdateEquipmentInputSchema,
} from '@/domain/equipment/schema';
import {
  assertEquipmentIdsKnown,
  canManageEquipment,
  canViewEquipmentCatalogue,
  findUnknownEquipmentIds,
} from '@/domain/equipment/policy';
import { quantityToSend } from '@/components/equipment/quantityInput';
import { DomainError } from '@/domain/shared/errors';
import type { Role } from '@/domain/identity/roles';

/**
 * SCRUM-240 Maintain the equipment catalogue: the rules that need no database.
 * The save and the read-back are tests/unit/equipment-service.test.ts (mocked
 * queries) and the manual run against the real row.
 *
 * AC text is from the Jira card (authoritative):
 *   AC1 "Given I am Technical Support Staff, when I add an equipment item with
 *        a name, category, quantity and current location, then it is saved and
 *        listed in the catalogue."
 *   AC2 "Given an item exists, when I set its operational status to Available,
 *        Unavailable, Damaged or Under maintenance, then the new status is
 *        saved and shown in the catalogue."
 *   AC3 "Given I hold any role other than Technical Support Staff, when I try
 *        to add or change an equipment item, then it is refused."
 *   AC4 "Given I enter a quantity below zero or a non-integer, when I save,
 *        then it is refused and the quantity field is identified."
 *   AC5 "Given the catalogue holds items, when a coordinator records an
 *        equipment requirement (SCRUM-160), then they can only choose items
 *        that exist in the catalogue."
 *
 * Test case IDs are from the Sprint 3 sheet's SCRUM-240 tab (TC-240-nn).
 */

const validItem = () => ({
  name: 'Projector P-100',
  category: 'av' as const,
  quantity: 4,
  currentLocation: 'Bugis store room',
});

const EQ_1 = '11111111-1111-4111-8111-111111111111';
const EQ_2 = '22222222-2222-4222-8222-222222222222';
const EQ_3 = '33333333-3333-4333-8333-333333333333';
const NOT_IN_CATALOGUE = '44444444-4444-4444-8444-444444444444';

/** The fieldErrors a refusal names, as the form reads them. */
function fieldsNamedBy(result: { success: boolean; error?: { flatten: () => { fieldErrors: Record<string, string[] | undefined> } } }) {
  if (result.success || !result.error) return {};
  return result.error.flatten().fieldErrors;
}

// -----------------------------------------------------------------------------
// AC1 — adding an item
// -----------------------------------------------------------------------------

describe('CreateEquipmentInputSchema: SCRUM-240 AC1', () => {
  it('TC-240-01 accepts a name, category, quantity and current location', () => {
    const result = CreateEquipmentInputSchema.safeParse(validItem());
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual({
      name: 'Projector P-100',
      category: 'av',
      quantity: 4,
      currentLocation: 'Bugis store room',
    });
  });

  it('TC-240-02 refuses an empty name, category and location, identifying all three', () => {
    const result = CreateEquipmentInputSchema.safeParse({
      name: '',
      category: '',
      quantity: 4,
      currentLocation: '',
    });
    expect(result.success).toBe(false);
    // Every field AC1 names is required, so each must be identified, not just
    // the first one that failed.
    expect(fieldsNamedBy(result)).toMatchObject({
      name: expect.any(Array),
      category: expect.any(Array),
      currentLocation: expect.any(Array),
    });
  });

  it('TC-240-02 refuses a name and location that are only whitespace', () => {
    const result = CreateEquipmentInputSchema.safeParse({ ...validItem(), name: '   ', currentLocation: '  ' });
    expect(result.success).toBe(false);
    expect(fieldsNamedBy(result)).toMatchObject({ name: expect.any(Array), currentLocation: expect.any(Array) });
  });

  it('TC-240-03 takes no operational status on add, so a new item starts Available', () => {
    // AC1 lists four fields and no status, so the add form cannot set one.
    const result = CreateEquipmentInputSchema.safeParse({ ...validItem(), operationalStatus: 'damaged' });
    expect(result.success).toBe(true);
    expect(result.success && 'operationalStatus' in result.data).toBe(false);
    expect(DEFAULT_OPERATIONAL_STATUS).toBe('available');
  });

  it('refuses a category that is not one of the catalogue categories', () => {
    const result = CreateEquipmentInputSchema.safeParse({ ...validItem(), category: 'pyrotechnics' });
    expect(result.success).toBe(false);
    expect(fieldsNamedBy(result)).toMatchObject({ category: expect.any(Array) });
  });

  it('keeps the category list in step with the labels shown in the catalogue', () => {
    expect(EQUIPMENT_CATEGORIES).toEqual(['av', 'furniture', 'computing', 'other']);
  });
});

// -----------------------------------------------------------------------------
// AC2 — the four operational statuses
// -----------------------------------------------------------------------------

describe('UpdateEquipmentInputSchema: SCRUM-240 AC2', () => {
  it.each(OPERATIONAL_STATUSES)('TC-240-04 accepts the status %s', (status) => {
    const result = UpdateEquipmentInputSchema.safeParse({ operationalStatus: status });
    expect(result.success).toBe(true);
    expect(result.success && result.data.operationalStatus).toBe(status);
  });

  it('TC-240-04 offers exactly the four statuses AC2 names, and no more', () => {
    expect(OPERATIONAL_STATUSES).toHaveLength(4);
    expect(Object.values(OPERATIONAL_STATUS_LABELS)).toEqual([
      'Available',
      'Unavailable',
      'Damaged',
      'Under maintenance',
    ]);
  });

  it('TC-240-05 refuses a status outside the four, identifying the status field', () => {
    const result = UpdateEquipmentInputSchema.safeParse({ operationalStatus: 'Broken' });
    expect(result.success).toBe(false);
    expect(fieldsNamedBy(result)).toMatchObject({ operationalStatus: expect.any(Array) });
  });

  it('TC-240-05 refuses the label rather than the stored value, so EQ-1 keeps its status', () => {
    // The UI sends the stored value ('under_maintenance'), never the label.
    expect(UpdateEquipmentInputSchema.safeParse({ operationalStatus: 'Under maintenance' }).success).toBe(false);
    expect(UpdateEquipmentInputSchema.safeParse({ operationalStatus: 'under_maintenance' }).success).toBe(true);
  });

  it('TC-240-06 leaves every field the change did not name untouched', () => {
    const result = UpdateEquipmentInputSchema.safeParse({ operationalStatus: 'damaged' });
    expect(result.success).toBe(true);
    // Nothing else is set, so the service sends no other column and the name,
    // category, quantity and location stay as they were.
    expect(result.success && result.data).toEqual({ operationalStatus: 'damaged' });
  });

  it('refuses a change that names no field at all', () => {
    expect(UpdateEquipmentInputSchema.safeParse({}).success).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// AC3 — only Technical Support Staff add or change an item
// -----------------------------------------------------------------------------

describe('canManageEquipment: SCRUM-240 AC3', () => {
  it('allows Technical Support Staff', () => {
    expect(canManageEquipment(['technical_support'])).toBe(true);
  });

  it('TC-240-07 refuses a Coordinator', () => {
    expect(canManageEquipment(['coordinator'])).toBe(false);
  });

  it.each<Role[]>([['venue_staff'], ['event_organiser'], ['attendee'], ['operations_manager']])(
    'TC-240-08 refuses %s',
    (role) => {
      expect(canManageEquipment([role])).toBe(false);
    },
  );

  it('TC-240-08 refuses an account with no role at all', () => {
    // No session is refused earlier still, as unauthenticated: getCurrentActor
    // throws before any permission is read (the route's own check).
    expect(canManageEquipment([])).toBe(false);
  });

  it('TC-240-09 allows an account that holds Technical Support as well as another role', () => {
    // AC3 refuses roles other than Technical Support Staff, not accounts that
    // hold another role as well (AccountRolesSchema, SCRUM-69).
    expect(canManageEquipment(['coordinator', 'technical_support'])).toBe(true);
  });
});

describe('canViewEquipmentCatalogue: SCRUM-240 AC3 and AC5', () => {
  it('lets a Coordinator read the catalogue, because AC5 has them choose from it', () => {
    expect(canViewEquipmentCatalogue(['coordinator'])).toBe(true);
  });

  it('lets Technical Support Staff read the catalogue they maintain', () => {
    expect(canViewEquipmentCatalogue(['technical_support'])).toBe(true);
  });

  it('TC-240-08 does not let an Attendee read it', () => {
    expect(canViewEquipmentCatalogue(['attendee'])).toBe(false);
  });

  it('reading is not changing: a Coordinator may view but not maintain', () => {
    expect(canViewEquipmentCatalogue(['coordinator'])).toBe(true);
    expect(canManageEquipment(['coordinator'])).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// AC4 — the quantity rule, on add and on edit
// -----------------------------------------------------------------------------

describe('quantity: SCRUM-240 AC4', () => {
  it('TC-240-10 refuses -1, identifying the quantity field', () => {
    const result = CreateEquipmentInputSchema.safeParse({ ...validItem(), quantity: -1 });
    expect(result.success).toBe(false);
    expect(fieldsNamedBy(result)).toMatchObject({ quantity: expect.any(Array) });
  });

  it('TC-240-10 accepts 0, which is not below zero', () => {
    const result = CreateEquipmentInputSchema.safeParse({ ...validItem(), quantity: 0 });
    expect(result.success).toBe(true);
    expect(result.success && result.data.quantity).toBe(0);
  });

  it.each([2.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'TC-240-11 refuses the non-integer quantity %s, identifying the field',
    (quantity) => {
      const result = CreateEquipmentInputSchema.safeParse({ ...validItem(), quantity });
      expect(result.success).toBe(false);
      expect(fieldsNamedBy(result)).toMatchObject({ quantity: expect.any(Array) });
    },
  );

  it.each(['ten', '4', ''])('TC-240-11 refuses the quantity %o sent as text', (quantity) => {
    const result = CreateEquipmentInputSchema.safeParse({ ...validItem(), quantity });
    expect(result.success).toBe(false);
    expect(fieldsNamedBy(result)).toMatchObject({ quantity: expect.any(Array) });
  });

  it('TC-240-11 refuses a quantity left out altogether, identifying the field', () => {
    const { quantity: _omitted, ...withoutQuantity } = validItem();
    const result = CreateEquipmentInputSchema.safeParse(withoutQuantity);
    expect(result.success).toBe(false);
    expect(fieldsNamedBy(result)).toMatchObject({ quantity: expect.any(Array) });
  });

  it('TC-240-12 refuses -2 on an edit: the rule holds on edit as well as on add', () => {
    const result = UpdateEquipmentInputSchema.safeParse({ quantity: -2 });
    expect(result.success).toBe(false);
    expect(fieldsNamedBy(result)).toMatchObject({ quantity: expect.any(Array) });
  });

  it('TC-240-13 accepts 6 on an edit', () => {
    const result = UpdateEquipmentInputSchema.safeParse({ quantity: 6 });
    expect(result.success).toBe(true);
    expect(result.success && result.data.quantity).toBe(6);
  });

  it('refuses a quantity above what the column can hold, rather than failing in Postgres', () => {
    expect(CreateEquipmentInputSchema.safeParse({ ...validItem(), quantity: 2_147_483_648 }).success).toBe(false);
  });
});

describe('quantityToSend: what the form sends for AC4', () => {
  it('TC-240-10 sends a whole number as a number, so the server can name the rule it broke', () => {
    expect(quantityToSend('4')).toBe(4);
    expect(quantityToSend('0')).toBe(0);
    expect(quantityToSend('-1')).toBe(-1);
  });

  it('TC-240-11 sends 2.5 and "ten" as typed, for the server to refuse', () => {
    expect(quantityToSend('2.5')).toBe('2.5');
    expect(quantityToSend('ten')).toBe('ten');
  });

  it('TC-240-11 sends nothing for an empty box, so the answer is "required"', () => {
    expect(quantityToSend('')).toBeUndefined();
    expect(quantityToSend('   ')).toBeUndefined();
  });

  it('does not quietly convert a value nobody typed', () => {
    // Number() alone reads "2e2" as 200 and "0x1F" as 31.
    expect(quantityToSend('2e2')).toBe('2e2');
    expect(quantityToSend('0x1F')).toBe('0x1F');
  });
});

// -----------------------------------------------------------------------------
// AC5 — a requirement can only name items the catalogue holds
// -----------------------------------------------------------------------------

describe('findUnknownEquipmentIds: SCRUM-240 AC5', () => {
  it('TC-240-14 finds nothing wrong with a requirement that names a catalogue item', () => {
    expect(findUnknownEquipmentIds([EQ_1, EQ_2], [EQ_1])).toEqual([]);
  });

  it('TC-240-15 names the id the catalogue does not hold', () => {
    expect(findUnknownEquipmentIds([EQ_1, EQ_2], [EQ_1, NOT_IN_CATALOGUE])).toEqual([NOT_IN_CATALOGUE]);
  });

  it('TC-240-15 treats an id that is not an id at all as not in the catalogue', () => {
    expect(findUnknownEquipmentIds([EQ_1], ['Smoke machine'])).toEqual(['Smoke machine']);
  });

  it('lists an unknown id once, however many times it was asked for', () => {
    expect(findUnknownEquipmentIds([EQ_1], [NOT_IN_CATALOGUE, NOT_IN_CATALOGUE])).toEqual([NOT_IN_CATALOGUE]);
  });

  it('TC-240-15 refuses the requirement with the equipment field identified', () => {
    expect(() => assertEquipmentIdsKnown([EQ_1], [NOT_IN_CATALOGUE])).toThrow(DomainError);
    try {
      assertEquipmentIdsKnown([EQ_1], [NOT_IN_CATALOGUE]);
    } catch (error) {
      const details = (error as DomainError).details as {
        fieldErrors: Record<string, string[]>;
        unknownEquipmentIds: string[];
      };
      expect(details.fieldErrors).toMatchObject({ equipmentId: expect.any(Array) });
      expect(details.unknownEquipmentIds).toEqual([NOT_IN_CATALOGUE]);
    }
  });

  it('TC-240-14 lets a requirement that names only catalogue items through', () => {
    expect(() => assertEquipmentIdsKnown([EQ_1, EQ_2], [EQ_1, EQ_2])).not.toThrow();
  });
});

describe('EquipmentOptionSchema: SCRUM-240 AC5', () => {
  const item = (id: string, operationalStatus: string) => ({
    id,
    name: `Item ${id.slice(0, 1)}`,
    category: 'av',
    quantity: 2,
    currentLocation: 'Bugis store room',
    operationalStatus,
    createdAt: '2026-10-13T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:00.000Z',
  });

  it('TC-240-16 offers a Damaged and an Under maintenance item as well as an Available one', () => {
    // AC5 limits the choice to items that exist, not to items free on the
    // date. What is free when is equipment availability (SCRUM-166/167/170),
    // which is not in this sprint.
    const offered = [item(EQ_1, 'available'), item(EQ_2, 'damaged'), item(EQ_3, 'under_maintenance')].map((row) =>
      EquipmentOptionSchema.parse(row),
    );
    expect(offered.map((option) => option.id)).toEqual([EQ_1, EQ_2, EQ_3]);
    expect(offered.map((option) => option.operationalStatus)).toEqual([
      'available',
      'damaged',
      'under_maintenance',
    ]);
  });

  it('carries the quantity, so the picker can show the stock held', () => {
    // Customer clarification #13: the system must know the quantity available.
    expect(EquipmentOptionSchema.parse(item(EQ_1, 'available')).quantity).toBe(2);
  });

  it('does not carry the location, which a requirement has no use for', () => {
    expect('currentLocation' in EquipmentOptionSchema.parse(item(EQ_1, 'available'))).toBe(false);
  });
});
