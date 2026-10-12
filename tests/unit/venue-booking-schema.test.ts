import { describe, it, expect } from 'vitest';
import {
  CreateVenueBookingRequestInputSchema,
  venueBookingRequestErrorDetails,
} from '@/domain/venue-booking/schema';

const VENUE_ID = '11111111-1111-1111-1111-111111111111';

/**
 * SCRUM-142 — Submit a venue booking request for an event (Jira,
 * authoritative).
 */
describe('CreateVenueBookingRequestInputSchema', () => {
  // AC1: a venue, a date, and the required slots.
  it('accepts one venue with a single date and slot', () => {
    const result = CreateVenueBookingRequestInputSchema.safeParse({
      venueId: VENUE_ID,
      lines: [{ date: '2026-11-15', timeSlots: ['pm'] }],
    });
    expect(result.success).toBe(true);
  });

  // AC1: "a date and the required slots" — more than one slot for one date.
  it('accepts more than one slot on a single date', () => {
    const result = CreateVenueBookingRequestInputSchema.safeParse({
      venueId: VENUE_ID,
      lines: [{ date: '2026-11-15', timeSlots: ['am', 'pm'] }],
    });
    expect(result.success).toBe(true);
  });

  // AC3: "my event needs the same venue on several dates... every requested
  // date and slot is carried on the one request".
  it('accepts more than one date on the same request', () => {
    const result = CreateVenueBookingRequestInputSchema.safeParse({
      venueId: VENUE_ID,
      lines: [
        { date: '2026-11-15', timeSlots: ['pm'] },
        { date: '2026-11-16', timeSlots: ['am'] },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.lines).toHaveLength(2);
  });

  it('refuses a request with no venue chosen', () => {
    const result = CreateVenueBookingRequestInputSchema.safeParse({
      venueId: '',
      lines: [{ date: '2026-11-15', timeSlots: ['pm'] }],
    });
    expect(result.success).toBe(false);
  });

  it('refuses a request with no date/slot lines at all', () => {
    const result = CreateVenueBookingRequestInputSchema.safeParse({
      venueId: VENUE_ID,
      lines: [],
    });
    expect(result.success).toBe(false);
  });

  it('refuses a line with no time slot chosen', () => {
    const result = CreateVenueBookingRequestInputSchema.safeParse({
      venueId: VENUE_ID,
      lines: [{ date: '2026-11-15', timeSlots: [] }],
    });
    expect(result.success).toBe(false);
  });

  it('refuses a time slot that is not am, pm or night', () => {
    const result = CreateVenueBookingRequestInputSchema.safeParse({
      venueId: VENUE_ID,
      lines: [{ date: '2026-11-15', timeSlots: ['midnight'] }],
    });
    expect(result.success).toBe(false);
  });
});

/**
 * SCRUM-142 AC5: "the missing fields are identified". Found in the Sprint 2
 * DoD re-test: flatten() filed every line's errors under one `lines` key, and
 * an empty date read "Invalid date", so the form could not say which line was
 * missing what.
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
    const details = detailsFor({ venueId: VENUE_ID, lines: [{ date, timeSlots: ['pm'] }] });
    expect(details.lineErrors).toEqual([{ date: ['Choose a date.'] }]);
  });

  it('names the empty date and the missing slot on the line they belong to', () => {
    const details = detailsFor({ venueId: VENUE_ID, lines: [{ date: '', timeSlots: [] }] });
    expect(details.lineErrors).toEqual([
      { date: ['Choose a date.'], timeSlots: ['Select at least one time slot for this date.'] },
    ]);
    expect(details.fieldErrors).toEqual({ venueId: undefined, lines: undefined });
    expect(details.formErrors).toEqual([]);
  });

  it("keeps each line's errors against that line, leaving a valid line empty", () => {
    const details = detailsFor({
      venueId: VENUE_ID,
      lines: [
        { date: '2026-11-15', timeSlots: ['pm'] },
        { date: '2026-11-16', timeSlots: [] },
        { date: '', timeSlots: ['am'] },
      ],
    });
    expect(details.lineErrors).toEqual([
      {},
      { timeSlots: ['Select at least one time slot for this date.'] },
      { date: ['Choose a date.'] },
    ]);
    // A valid first line is an empty object, not a hole that JSON sends as null.
    expect(JSON.parse(JSON.stringify(details)).lineErrors[0]).toEqual({});
  });

  it('names the venue as a field of its own', () => {
    const details = detailsFor({ venueId: '', lines: [{ date: '2026-11-15', timeSlots: ['pm'] }] });
    expect(details.fieldErrors.venueId).toEqual(['Venue must be chosen from the list.']);
    expect(details.lineErrors).toEqual([]);
  });

  it('reports a request with no dates at all against lines, not a line', () => {
    const details = detailsFor({ venueId: VENUE_ID, lines: [] });
    expect(details.fieldErrors.lines).toEqual(['At least one date is required.']);
    expect(details.lineErrors).toEqual([]);
  });
});
