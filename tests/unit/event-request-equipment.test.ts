import { describe, it, expect } from 'vitest';
import {
  describeEquipment,
  describeTechnicalSupport,
  incompleteFields,
  normaliseEquipment,
} from '@/domain/event-request/policy';
import {
  EQUIPMENT_ITEM_MAX_LENGTH,
  TECHNICAL_SUPPORT_NOTES_MAX_LENGTH,
  equipmentItemSchema,
  eventRequestDraftSchema,
  eventRequestSaveSchema,
  venueRequirementsSchema,
} from '@/domain/event-request/schema';

/**
 * SCRUM-80 — State equipment and technical support requirements.
 *
 * AC text is taken from the Jira card, which is authoritative.
 *
 * Sheet mapping (US-5.2 = SCRUM-79+80+81): US-5.2-TC03 (type, quantity and
 * notes saved) and US-5.2-TC04 (both sections left empty is a valid save) are
 * this ticket's. The sheet's "technical notes" per item is read as the Jira
 * card's request-level technical support description (AC2).
 *
 * Not coverable by a unit test - verify manually:
 *   "saved with the request" (every AC) — a database write; save a request
 *   and read the row on /events/[id].
 */

const A_MONDAY = '2026-11-09';

const basicDetails = {
  name: 'Annual Tech Summit',
  purpose: 'Networking',
  description: 'Yearly gathering',
  proposedDate: '2026-11-15',
};

const microphones = { item: 'Microphone', quantity: 4 };
const projector = { item: 'Projector', quantity: 1 };

describe('SCRUM-80 — State equipment and technical support requirements', () => {
  describe('AC1 — an equipment item and its quantity are saved with the request', () => {
    // US-5.2-TC03 — type=Microphone, quantity=4 saved against the request
    it('keeps the item and quantity on a full save', () => {
      const result = eventRequestSaveSchema.parse({
        ...basicDetails,
        equipmentRequired: true,
        equipmentItems: [microphones],
      });
      expect(normaliseEquipment(result)).toEqual({ required: true, items: [microphones] });
    });

    it('keeps them on a draft save too', () => {
      const result = eventRequestDraftSchema.parse({
        name: 'Summit',
        equipmentRequired: true,
        equipmentItems: [microphones, projector],
      });
      expect(normaliseEquipment(result).items).toEqual([microphones, projector]);
    });

    it('keeps the items in the order they were listed', () => {
      const result = normaliseEquipment({
        equipmentRequired: true,
        equipmentItems: [projector, microphones],
      });
      expect(result.items.map((entry) => entry.item)).toEqual(['Projector', 'Microphone']);
    });

    it('names a missing item or quantity', () => {
      const noItem = equipmentItemSchema.safeParse({ item: '   ', quantity: 2 });
      expect(noItem.success).toBe(false);
      expect(noItem.success ? [] : noItem.error.issues.map((i) => i.message)).toContain(
        'Equipment item is required',
      );

      const noQuantity = equipmentItemSchema.safeParse({ item: 'Microphone' });
      expect(noQuantity.success).toBe(false);
      expect(noQuantity.success ? [] : noQuantity.error.issues.map((i) => i.message)).toContain(
        'Quantity is required',
      );
    });

    it('refuses a quantity that is not a positive whole number', () => {
      for (const quantity of [0, -1, 2.5, 'four']) {
        expect(equipmentItemSchema.safeParse({ item: 'Microphone', quantity }).success).toBe(false);
      }
    });

    it('trims the item name and caps its length', () => {
      expect(equipmentItemSchema.parse({ item: '  Projector  ', quantity: 1 }).item).toBe('Projector');
      const tooLong = 'x'.repeat(EQUIPMENT_ITEM_MAX_LENGTH + 1);
      expect(equipmentItemSchema.safeParse({ item: tooLong, quantity: 1 }).success).toBe(false);
    });

    it('refuses the same item listed twice, ignoring case', () => {
      const result = venueRequirementsSchema.safeParse({
        equipmentItems: [microphones, { item: 'microphone', quantity: 2 }],
      });
      expect(result.success).toBe(false);
      expect(result.success ? [] : result.error.issues.map((i) => i.message)).toContain(
        'Each equipment item can only be listed once',
      );
    });

    it('is not needed to submit - the mandatory set is unchanged', () => {
      const complete = { ...basicDetails, startTime: '13:00', endTime: '18:00', expectedAttendance: 80 };
      expect(incompleteFields(complete, A_MONDAY)).toEqual([]);
    });

    it('shows each item with its quantity on the request', () => {
      expect(
        describeEquipment({ equipmentRequired: true, equipmentItems: [microphones, projector] }),
      ).toBe('Microphone × 4\nProjector × 1');
      expect(describeEquipment({ equipmentRequired: true, equipmentItems: [] })).toBe(
        'Required - items not yet listed',
      );
    });
  });

  describe('AC2 — the technical support description is saved whether or not any item is added', () => {
    // US-5.2-TC03 — notes=Wireless preferred saved alongside the item
    it('keeps the description alongside equipment items', () => {
      const result = eventRequestSaveSchema.parse({
        ...basicDetails,
        equipmentRequired: true,
        equipmentItems: [microphones],
        technicalSupportNotes: 'Wireless preferred',
      });
      expect(result.technicalSupportNotes).toBe('Wireless preferred');
    });

    it('keeps the description with no equipment items at all', () => {
      const result = eventRequestSaveSchema.parse({
        ...basicDetails,
        technicalSupportNotes: 'Someone to run the AV desk during the keynote',
      });
      expect(result.technicalSupportNotes).toBe('Someone to run the AV desk during the keynote');
      expect(result.equipmentItems).toEqual([]);
    });

    it('keeps the description even when the equipment answer is "none"', () => {
      // The description is not part of the equipment answer, so normalising
      // that answer must not touch it.
      const parsed = eventRequestSaveSchema.parse({
        ...basicDetails,
        equipmentRequired: false,
        technicalSupportNotes: 'Need a technician for the livestream',
      });
      expect(normaliseEquipment(parsed)).toEqual({ required: false, items: [] });
      expect(parsed.technicalSupportNotes).toBe('Need a technician for the livestream');
    });

    it('reads a blank box as "not entered"', () => {
      expect(eventRequestSaveSchema.parse({ ...basicDetails, technicalSupportNotes: '' }).technicalSupportNotes)
        .toBeUndefined();
    });

    it(`refuses a description longer than ${TECHNICAL_SUPPORT_NOTES_MAX_LENGTH} characters`, () => {
      const tooLong = 'x'.repeat(TECHNICAL_SUPPORT_NOTES_MAX_LENGTH + 1);
      expect(venueRequirementsSchema.safeParse({ technicalSupportNotes: tooLong }).success).toBe(false);
      expect(venueRequirementsSchema.safeParse({ technicalSupportNotes: tooLong.slice(1) }).success).toBe(true);
    });

    it('shows the description, or that none was given, on the request', () => {
      expect(describeTechnicalSupport('Wireless preferred')).toBe('Wireless preferred');
      expect(describeTechnicalSupport(null)).toBe('Not yet provided');
    });
  });

  describe('AC3 — "no equipment" saves with no items and the answer recorded as none', () => {
    // US-5.2-TC04 — equipment and technical-support sections left blank: valid save
    it('saves with both sections left empty', () => {
      const result = eventRequestSaveSchema.safeParse({ ...basicDetails, equipmentItems: [] });
      expect(result.success).toBe(true);
      expect(result.success && result.data.equipmentRequired).toBeUndefined();
      expect(result.success && result.data.technicalSupportNotes).toBeUndefined();
    });

    it('distinguishes "none" from "not yet answered"', () => {
      expect(normaliseEquipment({ equipmentRequired: false, equipmentItems: [] }).required).toBe(false);
      expect(normaliseEquipment({ equipmentItems: [] }).required).toBeNull();
    });

    it('drops items left over from before the answer became "none"', () => {
      expect(normaliseEquipment({ equipmentRequired: false, equipmentItems: [microphones] })).toEqual({
        required: false,
        items: [],
      });
    });

    it('drops them too while the question is still unanswered', () => {
      expect(normaliseEquipment({ equipmentItems: [microphones] })).toEqual({ required: null, items: [] });
    });

    it('tells the two apart on the request', () => {
      expect(describeEquipment({ equipmentRequired: false, equipmentItems: [] })).toBe('None required');
      expect(describeEquipment({ equipmentRequired: null, equipmentItems: [] })).toBe('Not yet answered');
    });
  });
});
