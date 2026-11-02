import { describe, expect, it } from 'vitest';
import { CHANGE_REQUEST_FORM_FIELDS, toProposedEquipmentItems } from '@/components/change-request/ChangeRequestForm';
import { formatChangeRequestValue } from '@/domain/change-request/policy';
import { RaiseChangeRequestInputSchema, SELECTABLE_CHANGE_REQUEST_FIELDS } from '@/domain/change-request/schema';

/**
 * SCRUM-274 (bug on SCRUM-187 AC1, AC6): the change request form left out
 * Accessibility features and Equipment items, two of the 16 fields CL-61
 * allows. They are offered now, checked by the same rules as the event
 * request form, and shown by name under Change requests. Test case IDs match
 * the SCRUM-274 tab of the test case sheet.
 */

const STEP_FREE = '11111111-1111-4111-8111-111111111111';
const HEARING_LOOP = '22222222-2222-4222-8222-222222222222';
const names = {
  accessibilityFeatures: new Map([
    [STEP_FREE, 'Step-free access'],
    [HEARING_LOOP, 'Hearing loop'],
  ]),
};

function raise(field: (typeof SELECTABLE_CHANGE_REQUEST_FIELDS)[number], proposedValue: unknown) {
  return RaiseChangeRequestInputSchema.safeParse({ fields: [{ field, proposedValue }], reason: 'A reason' });
}

describe('SCRUM-274: the change request form offers all 16 fields', () => {
  it('TC-274-01: the form lists every selectable field, in order, including Accessibility features and Equipment items', () => {
    const offered = CHANGE_REQUEST_FORM_FIELDS.map((def) => def.field);
    expect(offered).toEqual([...SELECTABLE_CHANGE_REQUEST_FIELDS]);
    expect(offered).toHaveLength(16);
    expect(offered).toContain('accessibilityFeatureIds');
    expect(offered).toContain('equipmentItems');
  });
});

describe('SCRUM-274: Accessibility features', () => {
  it('TC-274-01: a list of features from the list is accepted, and anything else is refused', () => {
    expect(raise('accessibilityFeatureIds', [STEP_FREE, HEARING_LOOP]).success).toBe(true);
    expect(raise('accessibilityFeatureIds', ['Step-free access']).success).toBe(false);
    expect(raise('accessibilityFeatureIds', 'Step-free access').success).toBe(false);
  });

  it("TC-274-01: the line reads by name, e.g. '— → Step-free access, Hearing loop'", () => {
    const current = formatChangeRequestValue('accessibilityFeatureIds', [], names);
    const proposed = formatChangeRequestValue('accessibilityFeatureIds', [STEP_FREE, HEARING_LOOP], names);
    expect(`${current} → ${proposed}`).toBe('None → Step-free access, Hearing loop');
    expect(formatChangeRequestValue('accessibilityFeatureIds', ['33333333-3333-4333-8333-333333333333'], names)).toBe(
      'Unknown feature',
    );
  });
});

describe('SCRUM-274: Equipment items', () => {
  it('TC-274-02: typed rows become the proposed list; blank rows are dropped', () => {
    expect(
      toProposedEquipmentItems([
        { item: ' Projector P-100 ', quantity: '2' },
        { item: '', quantity: '' },
      ]),
    ).toEqual([{ item: 'Projector P-100', quantity: 2 }]);
  });

  it('TC-274-02: a named item with a whole quantity above 0 is accepted; 0, a fraction or a repeat is refused', () => {
    expect(raise('equipmentItems', [{ item: 'Projector P-100', quantity: 2 }]).success).toBe(true);
    expect(raise('equipmentItems', [{ item: 'Projector P-100', quantity: 0 }]).success).toBe(false);
    expect(raise('equipmentItems', [{ item: 'Projector P-100', quantity: 1.5 }]).success).toBe(false);
    expect(raise('equipmentItems', [{ item: '', quantity: 2 }]).success).toBe(false);
    expect(
      raise('equipmentItems', [
        { item: 'Projector P-100', quantity: 1 },
        { item: 'projector p-100', quantity: 2 },
      ]).success,
    ).toBe(false);
  });

  it("TC-274-02: the line reads by item and quantity, e.g. 'None → Projector P-100 × 2'", () => {
    const current = formatChangeRequestValue('equipmentItems', []);
    const proposed = formatChangeRequestValue('equipmentItems', [{ item: 'Projector P-100', quantity: 2 }]);
    expect(`${current} → ${proposed}`).toBe('None → Projector P-100 × 2');
    // The event's current list comes back from the database with its position too.
    expect(
      formatChangeRequestValue('equipmentItems', [
        { position: 0, item: 'Wireless mic', quantity: 4 },
        { position: 1, item: 'Lectern', quantity: 1 },
      ]),
    ).toBe('Wireless mic × 4, Lectern × 1');
  });
});

describe('SCRUM-274: the other fields are unchanged (regression)', () => {
  it('TC-274-03: a text and a yes/no field are still accepted together, as in TC-187-16', () => {
    const parsed = RaiseChangeRequestInputSchema.safeParse({
      fields: [
        { field: 'name', proposedValue: 'Annual Tech Summit 2.0' },
        { field: 'registrationRequired', proposedValue: true },
      ],
      reason: 'Rebranding and opening registration',
    });
    expect(parsed.success).toBe(true);
    expect(formatChangeRequestValue('name', 'Annual Tech Summit 2.0')).toBe('Annual Tech Summit 2.0');
  });
});
