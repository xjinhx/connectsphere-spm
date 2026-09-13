import { describe, it, expect } from 'vitest';
import {
  canChangeRegistration,
  describeRegistration,
  incompleteFields,
  isEditable,
} from '@/domain/event-request/policy';
import {
  EventRequestStatusEnum,
  eventRequestDraftSchema,
  eventRequestSaveSchema,
  venueRequirementsSchema,
} from '@/domain/event-request/schema';

/**
 * SCRUM-81 — Indicate whether attendee registration is required.
 *
 * AC text is taken from the Jira card, which is authoritative.
 *
 * Sheet mapping (US-5.2 = SCRUM-79+80+81): US-5.2-TC05 (registration
 * required = Yes → choice saved) is this ticket's.
 *
 * AC3 names "Draft or Clarification Requested". Clarification Requested is
 * not a status yet (SCRUM-82 has draft/submitted only), so the rule is
 * asserted for Draft and its negative for Submitted; re-run this once that
 * status exists.
 *
 * Not coverable by a unit test - verify manually:
 *   "records" / "cleared" — a database write; save a draft with Yes, reopen
 *   it, switch to No, save, and read the row on /events/[id].
 */

const A_MONDAY = '2026-11-09';

const basicDetails = {
  name: 'Annual Tech Summit',
  purpose: 'Networking',
  description: 'Yearly gathering',
  proposedDate: '2026-11-15',
};

describe('SCRUM-81 — Indicate whether attendee registration is required', () => {
  describe('AC1 — marking registration as required is recorded', () => {
    // US-5.2-TC05 — registrationRequired=Yes: choice saved
    it('keeps a "yes" on a full save', () => {
      expect(
        eventRequestSaveSchema.parse({ ...basicDetails, registrationRequired: true }).registrationRequired,
      ).toBe(true);
    });

    it('keeps a "yes" on a draft save', () => {
      expect(
        eventRequestDraftSchema.parse({ name: 'Summit', registrationRequired: true }).registrationRequired,
      ).toBe(true);
    });

    it('only accepts a real yes/no, not text', () => {
      for (const invented of ['yes', 'true', 1]) {
        expect(venueRequirementsSchema.safeParse({ registrationRequired: invented }).success).toBe(false);
      }
    });

    it('is not needed to submit - the mandatory set is unchanged', () => {
      const complete = { ...basicDetails, timeSlots: ['pm'], expectedAttendance: 80 };
      expect(incompleteFields(complete, A_MONDAY)).toEqual([]);
    });

    it('shows "Required" on the request', () => {
      expect(describeRegistration(true)).toBe('Required');
    });
  });

  describe('AC2 — marking registration as not required records that, and nothing else', () => {
    it('keeps a "no" as an answer, distinct from not yet answered', () => {
      expect(
        eventRequestSaveSchema.parse({ ...basicDetails, registrationRequired: false }).registrationRequired,
      ).toBe(false);
      expect(eventRequestSaveSchema.parse(basicDetails).registrationRequired).toBeUndefined();
    });

    it('reads an untouched radio as unanswered', () => {
      expect(
        eventRequestSaveSchema.parse({ ...basicDetails, registrationRequired: '' }).registrationRequired,
      ).toBeUndefined();
    });

    it('records no other registration setting - the flag is the whole answer', () => {
      // Attendee Registration is a later sprint; the block has exactly one
      // registration field, so there is nothing else a "no" could leave behind.
      const registrationKeys = Object.keys(venueRequirementsSchema.shape).filter((key) =>
        key.toLowerCase().includes('registration'),
      );
      expect(registrationKeys).toEqual(['registrationRequired']);
    });

    it('shows "Not required" on the request, and tells it apart from unanswered', () => {
      expect(describeRegistration(false)).toBe('Not required');
      expect(describeRegistration(null)).toBe('Not yet answered');
    });
  });

  describe('AC3 — unmarking on an editable request clears the stored flag', () => {
    it('a later "no" replaces an earlier "yes" - the answer is whatever was last saved', () => {
      // Every save writes the column from the form (service.ts), so this is
      // the whole of "cleared": the same parse, with the new value.
      const first = eventRequestDraftSchema.parse({ name: 'Summit', registrationRequired: true });
      const second = eventRequestDraftSchema.parse({ name: 'Summit', registrationRequired: false });
      expect(first.registrationRequired).toBe(true);
      expect(second.registrationRequired).toBe(false);
    });

    it('can be changed on a draft', () => {
      expect(canChangeRegistration('draft')).toBe(true);
    });

    it('cannot be changed once submitted', () => {
      expect(canChangeRegistration('submitted')).toBe(false);
    });

    it('follows the same rule as editing the request, so the two never disagree', () => {
      for (const status of EventRequestStatusEnum.options) {
        expect(canChangeRegistration(status)).toBe(isEditable(status));
      }
    });
  });
});
