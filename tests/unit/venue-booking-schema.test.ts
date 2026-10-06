import { describe, it, expect } from 'vitest';
import { CreateVenueBookingRequestInputSchema } from '@/domain/venue-booking/schema';

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
