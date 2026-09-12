import { describe, it, expect } from 'vitest';
import {
  describeTimeSlots,
  incompleteFields,
  isFullDay,
  type StoredEventRequestFields,
} from '@/domain/event-request/policy';
import {
  eventRequestSaveSchema,
  normaliseTimeSlots,
  TIME_SLOT_HOURS,
  TIME_SLOT_ORDER,
  TimeSlotEnum,
  timeSlotsSchema,
} from '@/domain/event-request/schema';

/**
 * SCRUM-77 — Choose the time slots the event needs.
 *
 * AC text is taken from the Jira card, which is authoritative.
 *
 * Sheet mapping (US-5.1 = SCRUM-76+77+78): TC02 (only AM/PM/Night offered;
 * all three = full day) and TC03 (two slots on one date) are this ticket's.
 *
 * AC3 ("no slot chosen → submission blocked, told at least one is required")
 * is enforced by the completeness check that arrives with SCRUM-82, so its
 * tests were added on that branch - there was no submission to block before.
 * It has no sheet row yet and is tagged by Jira AC.
 *
 * Not coverable by a unit test - verify manually:
 *   AC1 "saved with the request" — a database write; save a request and read
 *        the time_slots column. Blocked on Authentication.
 *   AC4 "only the three defined slots are offered" — the picker on /events/new
 *        is built from TIME_SLOT_ORDER, which is asserted below.
 */

const A_MONDAY = '2026-11-09';

const basicDetails = {
  name: 'Annual Tech Summit',
  purpose: 'Networking',
  description: 'Yearly gathering',
  proposedDate: '2026-11-15',
};

const complete: StoredEventRequestFields = {
  ...basicDetails,
  timeSlots: ['PM'],
  expectedAttendance: 80,
};

describe('SCRUM-77 — Choose the time slots the event needs', () => {
  describe('AC1 — selected slots are saved with the request', () => {
    // US-5.1-TC03 — event spanning two slots on one date: both recorded in full
    it('keeps both slots when AM and PM are chosen for the same date', () => {
      const result = eventRequestSaveSchema.parse({ ...basicDetails, timeSlots: ['AM', 'PM'] });
      expect(result.timeSlots).toEqual(['AM', 'PM']);
    });

    it('stores slots in the order of the day, however they were picked', () => {
      expect(timeSlotsSchema.parse(['NIGHT', 'AM'])).toEqual(['AM', 'NIGHT']);
    });

    it('treats a selection as a set - the same slot twice is one slot', () => {
      expect(normaliseTimeSlots(['PM', 'PM', 'AM'])).toEqual(['AM', 'PM']);
    });

    it('allows a request to be saved with no slot chosen yet', () => {
      // AC3 blocks submission without a slot, not saving.
      expect(eventRequestSaveSchema.safeParse({ ...basicDetails, timeSlots: [] }).success).toBe(true);
      expect(eventRequestSaveSchema.parse(basicDetails).timeSlots).toEqual([]);
    });
  });

  describe('AC2 — all three slots is a full-day booking requirement', () => {
    // US-5.1-TC02 — selecting AM, PM and Night together records the event as full day
    it('recognises AM + PM + Night as a full day', () => {
      expect(isFullDay(['AM', 'PM', 'NIGHT'])).toBe(true);
      expect(describeTimeSlots(['AM', 'PM', 'NIGHT'])).toBe('Full day');
    });

    it('does not call two slots a full day', () => {
      expect(isFullDay(['AM', 'PM'])).toBe(false);
      expect(describeTimeSlots(['AM', 'PM'])).toBe('AM (07:00–12:00), PM (13:00–18:00)');
    });

    it('is a full day regardless of the order the slots were picked', () => {
      expect(isFullDay(['NIGHT', 'AM', 'PM'])).toBe(true);
    });

    it('shows "not yet provided" until a slot is chosen', () => {
      expect(describeTimeSlots(null)).toBe('Not yet provided');
      expect(describeTimeSlots([])).toBe('Not yet provided');
    });
  });

  describe('AC3 — no slot chosen: submission is blocked and the organiser is told', () => {
    it('names time slots as incomplete when none are chosen', () => {
      const result = incompleteFields({ ...complete, timeSlots: [] }, A_MONDAY);
      expect(result).toEqual([
        { field: 'timeSlots', label: 'Time slots', reason: 'Select at least one time slot' },
      ]);
    });

    it('treats slots that were never chosen the same as an empty choice', () => {
      const result = incompleteFields({ ...complete, timeSlots: null }, A_MONDAY);
      expect(result.map((item) => item.field)).toEqual(['timeSlots']);
    });

    it('is satisfied by a single slot', () => {
      expect(incompleteFields({ ...complete, timeSlots: ['NIGHT'] }, A_MONDAY)).toEqual([]);
    });
  });

  describe('AC4 — only the three defined slots exist; none crosses midnight', () => {
    // US-5.1-TC02 — slot picker offers only AM / PM / Night
    it('offers exactly AM, PM and Night, in that order', () => {
      expect(TIME_SLOT_ORDER).toEqual(['AM', 'PM', 'NIGHT']);
      expect(TimeSlotEnum.options).toHaveLength(3);
    });

    it('refuses any slot that is not one of the three', () => {
      for (const invented of ['MIDNIGHT', 'LATE', 'OVERNIGHT', 'am']) {
        expect(timeSlotsSchema.safeParse([invented]).success).toBe(false);
      }
    });

    it('refuses an otherwise valid selection if one entry is not a real slot', () => {
      expect(timeSlotsSchema.safeParse(['AM', 'MIDNIGHT']).success).toBe(false);
    });

    it('has no slot that runs past midnight', () => {
      for (const slot of TIME_SLOT_ORDER) {
        const { start, end } = TIME_SLOT_HOURS[slot];
        expect(end).toBeGreaterThan(start);
        expect(end).toBeLessThanOrEqual(24);
      }
    });

    it("matches the customer's hours: 07-12, 13-18, 19-24 (clarification #50)", () => {
      expect(TIME_SLOT_HOURS).toEqual({
        AM: { start: 7, end: 12 },
        PM: { start: 13, end: 18 },
        NIGHT: { start: 19, end: 24 },
      });
    });
  });
});
