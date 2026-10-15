import { describe, it, expect } from 'vitest';
import { isWithinOpeningHours } from '@/domain/venues/policy';
import { isOutsideOpeningHours, outsideOpeningHoursMessage } from '@/domain/venue-booking/policy';

/**
 * SCRUM-226 — setup and turnaround must fit inside the venue's opening hours
 * (PO assumption, 8 Oct 2026). Search (SCRUM-239 AC2) and booking requests
 * (SCRUM-239 AC1) both use isWithinOpeningHours, so both get the rule.
 *
 * Test case IDs are from the SCRUM-226 tab of the test case sheet.
 */
describe('SCRUM-226 — setup and turnaround inside opening hours', () => {
  // TC-226-18: opens 08:00, closes 22:00, 30 min setup, 0 turnaround
  describe('TC-226-18 — setup must start at or after opening', () => {
    const hours = { opensAt: '08:00', closesAt: '22:00' } as const;
    const times = { setupMinutes: 30, turnaroundMinutes: 0 };

    it('refuses an 08:00 start: setup would start at 07:30, before opening', () => {
      expect(isWithinOpeningHours({ start: '08:00', end: '10:00' }, hours, times)).toBe(false);
      expect(isOutsideOpeningHours({ start: '08:00', end: '10:00' }, hours, times)).toBe(true);
    });

    it('accepts an 08:30 start: setup starts exactly at opening', () => {
      expect(isWithinOpeningHours({ start: '08:30', end: '10:00' }, hours, times)).toBe(true);
    });

    it('refuses 08:15, one 15-minute step too early', () => {
      expect(isWithinOpeningHours({ start: '08:15', end: '10:00' }, hours, times)).toBe(false);
    });
  });

  // TC-226-19: closes 22:00, 0 setup, 45 min turnaround
  describe('TC-226-19 — turnaround must end by closing', () => {
    const hours = { opensAt: '08:00', closesAt: '22:00' } as const;
    const times = { setupMinutes: 0, turnaroundMinutes: 45 };

    it('refuses a 21:30 end: turnaround would run to 22:15, after closing', () => {
      expect(isWithinOpeningHours({ start: '20:00', end: '21:30' }, hours, times)).toBe(false);
    });

    it('accepts a 21:15 end: turnaround ends exactly at closing', () => {
      expect(isWithinOpeningHours({ start: '20:00', end: '21:15' }, hours, times)).toBe(true);
    });
  });

  describe('a venue with 0 setup and 0 turnaround is unchanged', () => {
    const hours = { opensAt: '08:00', closesAt: '22:00' } as const;

    it('still accepts the full opening hours and refuses past them', () => {
      expect(isWithinOpeningHours({ start: '08:00', end: '22:00' }, hours)).toBe(true);
      expect(isWithinOpeningHours({ start: '08:00', end: '22:00' }, hours, { setupMinutes: 0, turnaroundMinutes: 0 })).toBe(true);
      expect(isWithinOpeningHours({ start: '07:45', end: '09:00' }, hours)).toBe(false);
    });
  });

  describe('the refusal message says what had to fit', () => {
    const hours = { opensAt: '08:00', closesAt: '22:00' } as const;

    it('names the setup and turnaround when the venue has them', () => {
      expect(outsideOpeningHoursMessage(hours, { setupMinutes: 30, turnaroundMinutes: 45 })).toBe(
        "Outside this venue's opening hours (08:00–22:00), including its 30-minute setup and 45-minute turnaround.",
      );
      expect(outsideOpeningHoursMessage(hours, { setupMinutes: 30, turnaroundMinutes: 0 })).toBe(
        "Outside this venue's opening hours (08:00–22:00), including its 30-minute setup.",
      );
    });

    it('keeps the SCRUM-239 message for a venue with neither', () => {
      expect(outsideOpeningHoursMessage(hours)).toBe("Outside this venue's opening hours (08:00–22:00).");
    });
  });
});
