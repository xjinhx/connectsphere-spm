import { describe, it, expect } from 'vitest';
import {
  CreateVenueBookingRequestInputSchema,
  venueBookingRequestErrorDetails,
} from '@/domain/venue-booking/schema';

const VENUE_ID = '11111111-1111-1111-1111-111111111111';

/**
 * SCRUM-142 — Submit a venue booking request for an event (Jira,
 * authoritative), with each line a date and a start and end time since
 * SCRUM-239 AC3 (customer change Week 7 #1). SCRUM-142's slot cases carry over
 * as times.
 */
describe('CreateVenueBookingRequestInputSchema', () => {
  // AC1: a venue, a date, and the period needed.
  it('accepts one venue with a single date and period', () => {
    const result = CreateVenueBookingRequestInputSchema.safeParse({
      venueId: VENUE_ID,
      lines: [{ date: '2026-11-15', start: '13:00', end: '18:00' }],
    });
    expect(result.success).toBe(true);
  });

  // AC3: "my event needs the same venue on several dates... every requested
  // date is carried on the one request".
  it('accepts more than one date on the same request', () => {
    const result = CreateVenueBookingRequestInputSchema.safeParse({
      venueId: VENUE_ID,
      lines: [
        { date: '2026-11-15', start: '13:00', end: '18:00' },
        { date: '2026-11-16', start: '09:00', end: '11:30' },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.lines).toHaveLength(2);
  });

  it('accepts 24:00 as an end time (a former Night slot ends then)', () => {
    const result = CreateVenueBookingRequestInputSchema.safeParse({
      venueId: VENUE_ID,
      lines: [{ date: '2026-11-15', start: '19:00', end: '24:00' }],
    });
    expect(result.success).toBe(true);
  });

  it('refuses a request with no venue chosen', () => {
    const result = CreateVenueBookingRequestInputSchema.safeParse({
      venueId: '',
      lines: [{ date: '2026-11-15', start: '13:00', end: '18:00' }],
    });
    expect(result.success).toBe(false);
  });

  it('refuses a request with no lines at all', () => {
    const result = CreateVenueBookingRequestInputSchema.safeParse({ venueId: VENUE_ID, lines: [] });
    expect(result.success).toBe(false);
  });

  // SCRUM-238 AC4, as the request form uses the same unit (TC-239-02 for times).
  it.each([
    ['a start off the 15-minute step', '10:10', '12:00'],
    ['an end off the 15-minute step', '10:00', '12:05'],
    ['24:00 as a start', '24:00', '24:00'],
  ])('refuses %s', (_label, start, end) => {
    const result = CreateVenueBookingRequestInputSchema.safeParse({
      venueId: VENUE_ID,
      lines: [{ date: '2026-11-15', start, end }],
    });
    expect(result.success).toBe(false);
  });
});

/**
 * SCRUM-142 AC5: "the missing fields are identified". Found in the Sprint 2
 * DoD re-test (SCRUM-237): flatten() filed every line's errors under one
 * `lines` key, and an empty date read "Invalid date", so the form could not
 * say which line was missing what. Kept for the start and end times that
 * replace the slots.
 */
describe('venueBookingRequestErrorDetails (AC5)', () => {
  function detailsFor(input: unknown) {
    const result = CreateVenueBookingRequestInputSchema.safeParse(input);
    if (result.success) throw new Error('expected the input to be refused');
    return venueBookingRequestErrorDetails(result.error);
  }

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['missing', undefined],
  ])('asks for a %s date by name', (_label, date) => {
    const details = detailsFor({ venueId: VENUE_ID, lines: [{ date, start: '13:00', end: '18:00' }] });
    expect(details.lineErrors).toEqual([{ date: ['Choose a date.'] }]);
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['missing', undefined],
  ])('asks for a %s start and end time by name', (_label, time) => {
    const details = detailsFor({ venueId: VENUE_ID, lines: [{ date: '2026-11-15', start: time, end: time }] });
    expect(details.lineErrors).toEqual([{ start: ['Choose a start time.'], end: ['Choose an end time.'] }]);
  });

  it('names the empty date and the missing times on the line they belong to', () => {
    const details = detailsFor({ venueId: VENUE_ID, lines: [{ date: '', start: '', end: '' }] });
    expect(details.lineErrors).toEqual([
      { date: ['Choose a date.'], start: ['Choose a start time.'], end: ['Choose an end time.'] },
    ]);
    expect(details.fieldErrors).toEqual({ venueId: undefined, lines: undefined });
    expect(details.formErrors).toEqual([]);
  });

  // SCRUM-238 AC2's rule: both time fields are identified.
  it('flags both times when the end is not after the start', () => {
    const details = detailsFor({ venueId: VENUE_ID, lines: [{ date: '2026-11-15', start: '14:00', end: '13:00' }] });
    expect(details.lineErrors).toEqual([
      { start: ['The end time must be after the start time.'], end: ['The end time must be after the start time.'] },
    ]);
  });

  it("keeps each line's errors against that line, leaving a valid line empty", () => {
    const details = detailsFor({
      venueId: VENUE_ID,
      lines: [
        { date: '2026-11-15', start: '13:00', end: '18:00' },
        { date: '2026-11-16', start: '', end: '18:00' },
        { date: '', start: '09:00', end: '10:00' },
      ],
    });
    expect(details.lineErrors).toEqual([{}, { start: ['Choose a start time.'] }, { date: ['Choose a date.'] }]);
    // A valid first line is an empty object, not a hole that JSON sends as null.
    expect(JSON.parse(JSON.stringify(details)).lineErrors[0]).toEqual({});
  });

  it('names the venue as a field of its own', () => {
    const details = detailsFor({ venueId: '', lines: [{ date: '2026-11-15', start: '13:00', end: '18:00' }] });
    expect(details.fieldErrors.venueId).toEqual(['Venue must be chosen from the list.']);
    expect(details.lineErrors).toEqual([]);
  });

  it('reports a request with no dates at all against lines, not a line', () => {
    const details = detailsFor({ venueId: VENUE_ID, lines: [] });
    expect(details.fieldErrors.lines).toEqual(['At least one date is required.']);
    expect(details.lineErrors).toEqual([]);
  });
});
