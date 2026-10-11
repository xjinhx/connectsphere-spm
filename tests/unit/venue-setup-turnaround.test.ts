import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { UpdateVenueInputSchema } from '@/domain/venues/schema';
import {
  committedMinutes,
  committedTimesOverlap,
  findNewSetupTurnaroundClashes,
  type DatedBooking,
} from '@/domain/venues/policy';

/**
 * SCRUM-225 Record setup and turnaround time for each venue: the rules that
 * need no database. The save itself is tests/integration/venue-setup-turnaround.test.ts.
 *
 * AC text is from the Jira card (authoritative):
 *   AC1 "Given I am editing a venue, when I enter a setup time and a turnaround
 *        time in whole minutes (in 15 minutes intervals) and save, then both
 *        are stored against that venue and shown to every internal user who
 *        views it."
 *   AC2 "Given I enter a negative or any value that is not a multiple of 15,
 *        when I save, then the save is refused and the field is identified."
 *   AC4 "Given two confirmed bookings 10:00-12:00 and 13:00-15:00 on 10 Nov
 *        2026, when I set its turnaround to 90 minutes and save, then both
 *        bookings are listed and must be confirmed before the change is
 *        applied."
 *
 * Test case IDs are from Joshua's Sprint 3 sheet (TC-225-nn).
 */

const UPDATED_AT = '2026-10-10T04:00:00.000Z';

const fieldErrors = (result: z.SafeParseReturnType<unknown, unknown>) =>
  result.success ? {} : result.error.flatten().fieldErrors;

describe('UpdateVenueInputSchema: SCRUM-225 AC1, valid times', () => {
  it('TC-225-01 accepts a setup of 30 and a turnaround of 45 minutes', () => {
    const result = UpdateVenueInputSchema.safeParse({ expectedUpdatedAt: UPDATED_AT, setupMinutes: 30, turnaroundMinutes: 45 });
    expect(result.success).toBe(true);
  });

  it('TC-225-03 accepts 0 and 15, the lowest valid values', () => {
    const result = UpdateVenueInputSchema.safeParse({ expectedUpdatedAt: UPDATED_AT, setupMinutes: 0, turnaroundMinutes: 15 });
    expect(result.success).toBe(true);
  });

  it('accepts one of the two on its own, leaving the other unchanged', () => {
    const result = UpdateVenueInputSchema.safeParse({ expectedUpdatedAt: UPDATED_AT, turnaroundMinutes: 90 });
    expect(result.success).toBe(true);
    expect(result.success && result.data.setupMinutes).toBeUndefined();
  });

  it('treats a confirmation alone as nothing to update', () => {
    const result = UpdateVenueInputSchema.safeParse({ expectedUpdatedAt: UPDATED_AT, confirmSetupTurnaroundChange: true });
    expect(result.success).toBe(false);
  });
});

describe('UpdateVenueInputSchema: SCRUM-225 AC2, the field is identified', () => {
  it('TC-225-04 refuses a negative setup and names the setup field', () => {
    const result = UpdateVenueInputSchema.safeParse({ expectedUpdatedAt: UPDATED_AT, setupMinutes: -15 });
    expect(fieldErrors(result)).toEqual({ setupMinutes: ['Setup time cannot be negative.'] });
  });

  it('TC-225-05 refuses 14, just below a 15-minute step, and names the turnaround field', () => {
    const result = UpdateVenueInputSchema.safeParse({ expectedUpdatedAt: UPDATED_AT, turnaroundMinutes: 14 });
    expect(fieldErrors(result)).toEqual({
      turnaroundMinutes: ['Turnaround time must be in 15-minute steps (0, 15, 30, 45 and so on).'],
    });
  });

  it('TC-225-06 refuses 16, just above a 15-minute step', () => {
    const result = UpdateVenueInputSchema.safeParse({ expectedUpdatedAt: UPDATED_AT, turnaroundMinutes: 16 });
    expect(Object.keys(fieldErrors(result))).toEqual(['turnaroundMinutes']);
  });

  it('TC-225-07 refuses 15.5, which is not a whole number', () => {
    const result = UpdateVenueInputSchema.safeParse({ expectedUpdatedAt: UPDATED_AT, setupMinutes: 15.5 });
    expect(fieldErrors(result)).toEqual({ setupMinutes: ['Setup time must be a whole number of minutes.'] });
  });

  it('refuses text, as the form sends anything that is not a whole number', () => {
    const result = UpdateVenueInputSchema.safeParse({ expectedUpdatedAt: UPDATED_AT, setupMinutes: 'abc' });
    expect(fieldErrors(result)).toEqual({ setupMinutes: ['Setup time must be a whole number of minutes.'] });
  });

  it('TC-225-08 names only the invalid field when the other is valid', () => {
    const result = UpdateVenueInputSchema.safeParse({ expectedUpdatedAt: UPDATED_AT, setupMinutes: 60, turnaroundMinutes: 20 });
    expect(Object.keys(fieldErrors(result))).toEqual(['turnaroundMinutes']);
  });
});

// -----------------------------------------------------------------------------
// AC4: which bookings a change makes clash
// -----------------------------------------------------------------------------

const NONE = { setupMinutes: 0, turnaroundMinutes: 0 };

function booking(id: string, eventId: string, start: string, end: string, date = '2026-11-10'): DatedBooking {
  return { bookingId: id, eventId, date, start, end };
}

/** AC4's example: 10:00-12:00 and 13:00-15:00 on 10 Nov 2026, two events. */
const B1 = booking('b1', 'event-1', '10:00', '12:00');
const B2 = booking('b2', 'event-2', '13:00', '15:00');

describe('committedMinutes: the time a booking commits its venue for', () => {
  it('runs from start minus setup to end plus turnaround', () => {
    // SCRUM-226's example: 30 setup, 45 turnaround, 10:00-12:00 is 09:30-12:45.
    expect(committedMinutes({ start: '10:00', end: '12:00' }, { setupMinutes: 30, turnaroundMinutes: 45 })).toEqual({
      start: 9 * 60 + 30,
      end: 12 * 60 + 45,
    });
  });

  it('can run past midnight, which no clock time can say', () => {
    expect(committedMinutes({ start: '22:00', end: '24:00' }, { setupMinutes: 0, turnaroundMinutes: 30 }).end).toBe(1470);
  });

  it('does not count touching periods as overlapping', () => {
    expect(committedTimesOverlap(B1, B2, { setupMinutes: 0, turnaroundMinutes: 60 })).toBe(false);
    expect(committedTimesOverlap(B1, B2, { setupMinutes: 0, turnaroundMinutes: 75 })).toBe(true);
  });
});

describe('findNewSetupTurnaroundClashes: SCRUM-225 AC4', () => {
  it('TC-225-11 lists both bookings when a 90-minute turnaround runs B1 to 13:30, past B2 at 13:00', () => {
    expect(findNewSetupTurnaroundClashes([B1, B2], NONE, { setupMinutes: 0, turnaroundMinutes: 90 })).toEqual([B1, B2]);
  });

  it('TC-225-13 lists nothing when a 60-minute turnaround ends exactly at B2\'s start', () => {
    expect(findNewSetupTurnaroundClashes([B1, B2], NONE, { setupMinutes: 0, turnaroundMinutes: 60 })).toEqual([]);
  });

  it('TC-225-14 lists both when a 75-minute turnaround is one step past the gap', () => {
    expect(findNewSetupTurnaroundClashes([B1, B2], NONE, { setupMinutes: 0, turnaroundMinutes: 75 })).toEqual([B1, B2]);
  });

  it('TC-225-15 counts setup too: 30 setup and 45 turnaround run B1 to 12:45 and B2 from 12:30', () => {
    const current = { setupMinutes: 0, turnaroundMinutes: 45 };
    expect(findNewSetupTurnaroundClashes([B1, B2], current, { setupMinutes: 30, turnaroundMinutes: 45 })).toEqual([B1, B2]);
  });

  it('TC-225-16 lists nothing for a venue with only one booking', () => {
    expect(findNewSetupTurnaroundClashes([B1], NONE, { setupMinutes: 0, turnaroundMinutes: 90 })).toEqual([]);
  });

  it('TC-225-18 leaves out a booking the change does not affect', () => {
    const B3 = booking('b3', 'event-3', '17:00', '19:00');
    // B2 now runs to 16:30, still before B3 at 17:00.
    expect(findNewSetupTurnaroundClashes([B1, B2, B3], NONE, { setupMinutes: 0, turnaroundMinutes: 90 })).toEqual([B1, B2]);
  });

  it('does not clash bookings on different dates', () => {
    const nextDay = booking('b2', 'event-2', '13:00', '15:00', '2026-11-11');
    expect(findNewSetupTurnaroundClashes([B1, nextDay], NONE, { setupMinutes: 0, turnaroundMinutes: 90 })).toEqual([]);
  });

  it("never clashes an event's own bookings with each other", () => {
    const sameEvent = booking('b2', 'event-1', '13:00', '15:00');
    expect(findNewSetupTurnaroundClashes([B1, sameEvent], NONE, { setupMinutes: 0, turnaroundMinutes: 90 })).toEqual([]);
  });

  it('does not list bookings that already clashed before the change', () => {
    const current = { setupMinutes: 0, turnaroundMinutes: 90 };
    expect(findNewSetupTurnaroundClashes([B1, B2], current, { setupMinutes: 0, turnaroundMinutes: 120 })).toEqual([]);
  });

  it('lists nothing when the change shortens the times', () => {
    const current = { setupMinutes: 30, turnaroundMinutes: 45 };
    expect(findNewSetupTurnaroundClashes([B1, B2], current, NONE)).toEqual([]);
  });
});
