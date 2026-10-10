import { describe, it, expect } from 'vitest';
import { describeTimeSlots, isFullDay } from '@/domain/event-request/policy';
import {
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
 * SUPERSEDED for event requests by SCRUM-238 (customer change Week 7 #1): a
 * request now has a start and end time, tested in event-request-times.test.ts.
 * SCRUM-77 stays Done (scenario 2 of the Week 7 guide). What is left here is
 * the slot definitions themselves, still used by venue booking request lines
 * until SCRUM-239 moves them to times. AC1 (slots saved with the request), AC3
 * (no slot blocks submission) and AC5 (slot already ended today) were removed
 * with the behaviour; AC5's fix lives on as SCRUM-238 AC5.
 *
 * Sheet mapping (US-5.1 = SCRUM-76+77+78): TC02 (only am/pm/night offered;
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

describe('SCRUM-77 — Choose the time slots the event needs', () => {
  describe('AC1 — a selection is a set, in day order', () => {
    it('stores slots in the order of the day, however they were picked', () => {
      expect(timeSlotsSchema.parse(['night', 'am'])).toEqual(['am', 'night']);
    });

    it('treats a selection as a set - the same slot twice is one slot', () => {
      expect(normaliseTimeSlots(['pm', 'pm', 'am'])).toEqual(['am', 'pm']);
    });
  });

  describe('AC2 — all three slots is a full-day booking requirement', () => {
    // US-5.1-TC02 — selecting am, pm and night together records the event as full day
    it('recognises am + pm + night as a full day', () => {
      expect(isFullDay(['am', 'pm', 'night'])).toBe(true);
      expect(describeTimeSlots(['am', 'pm', 'night'])).toBe('Full day');
    });

    it('does not call two slots a full day', () => {
      expect(isFullDay(['am', 'pm'])).toBe(false);
      expect(describeTimeSlots(['am', 'pm'])).toBe('AM (07:00–12:00), PM (13:00–18:00)');
    });

    it('is a full day regardless of the order the slots were picked', () => {
      expect(isFullDay(['night', 'am', 'pm'])).toBe(true);
    });

    it('shows "not yet provided" until a slot is chosen', () => {
      expect(describeTimeSlots(null)).toBe('Not yet provided');
      expect(describeTimeSlots([])).toBe('Not yet provided');
    });
  });

  describe('AC4 — only the three defined slots exist; none crosses midnight', () => {
    // US-5.1-TC02 — slot picker offers only am / pm / night
    it('offers exactly am, pm and night, in that order', () => {
      expect(TIME_SLOT_ORDER).toEqual(['am', 'pm', 'night']);
      expect(TimeSlotEnum.options).toHaveLength(3);
    });

    it('refuses any slot that is not one of the three', () => {
      // 'AM' (uppercase) is deliberately included: now that lowercase is
      // canonical, the enum must still be case-sensitive rather than
      // silently accepting either casing.
      for (const invented of ['MIDNIGHT', 'LATE', 'OVERNIGHT', 'AM']) {
        expect(timeSlotsSchema.safeParse([invented]).success).toBe(false);
      }
    });

    it('refuses an otherwise valid selection if one entry is not a real slot', () => {
      expect(timeSlotsSchema.safeParse(['am', 'MIDNIGHT']).success).toBe(false);
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
        am: { start: 7, end: 12 },
        pm: { start: 13, end: 18 },
        night: { start: 19, end: 24 },
      });
    });
  });
});