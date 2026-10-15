import { describe, it, expect } from 'vitest';
import { CreateVenueBookingRequestInputSchema, venueBookingRequestErrorDetails } from '@/domain/venue-booking/schema';
import { markIfEvents, venueRequirementsOf } from '@/domain/venue-booking/policy';

/**
 * SCRUM-230 Give each venue booking its own attendance and requirements (Jira,
 * authoritative). AC1: "I can enter the expected attendance, layout and
 * accessibility needs for that space". AC2: "Given I leave them empty ... the
 * event's own ... are used and shown as the event's".
 *
 * The input rules and the "own or event's" answer. Creating the request runs
 * against the database in tests/integration/booking-request-venue-requirements.test.ts.
 */

const LINE = { date: '2026-11-10', start: '10:00', end: '13:00' };
const VENUE_ID = '11111111-1111-4111-8111-111111111111';

function attendanceErrors(expectedAttendance: unknown): string[] | undefined {
  const result = CreateVenueBookingRequestInputSchema.safeParse({ venueId: VENUE_ID, lines: [LINE], expectedAttendance });
  return result.success ? undefined : venueBookingRequestErrorDetails(result.error).fieldErrors.expectedAttendance;
}

describe("a request's own venue requirements (AC1)", () => {
  it('accepts attendance, layout and accessibility for the venue (TC-230-01)', () => {
    const parsed = CreateVenueBookingRequestInputSchema.parse({
      venueId: VENUE_ID,
      lines: [LINE],
      expectedAttendance: 40,
      roomLayout: 'classroom',
      accessibilityRequired: true,
      accessibilityNotes: 'Hearing loop',
    });

    expect(parsed).toMatchObject({
      expectedAttendance: 40,
      roomLayout: 'classroom',
      accessibilityRequired: true,
      accessibilityNotes: 'Hearing loop',
    });
  });

  it('refuses an attendance of 0 and names the field (TC-230-02)', () => {
    expect(attendanceErrors(0)).toEqual(['Expected attendance must be a positive whole number']);
  });

  it('accepts an attendance of 1, the smallest allowed', () => {
    expect(attendanceErrors(1)).toBeUndefined();
  });

  it('refuses an attendance that is not a whole number and names the field (TC-230-12)', () => {
    expect(attendanceErrors(12.5)).toEqual(['Expected attendance must be a positive whole number']);
  });

  it('refuses a layout that is not one of the seven', () => {
    const result = CreateVenueBookingRequestInputSchema.safeParse({ venueId: VENUE_ID, lines: [LINE], roomLayout: 'stadium' });
    expect(result.success).toBe(false);
  });

  it('leaves every one out when the form sends them empty (TC-230-03)', () => {
    const parsed = CreateVenueBookingRequestInputSchema.parse({
      venueId: VENUE_ID,
      lines: [LINE],
      expectedAttendance: '',
      roomLayout: '',
      accessibilityRequired: null,
      accessibilityNotes: '',
    });

    expect(parsed.expectedAttendance).toBeUndefined();
    expect(parsed.roomLayout).toBeUndefined();
    expect(parsed.accessibilityRequired).toBeUndefined();
    expect(parsed.accessibilityNotes).toBeUndefined();
  });
});

describe('venueRequirementsOf: own, or the event\'s (AC2)', () => {
  const event = {
    expectedAttendance: 250,
    roomLayout: 'theatre',
    accessibilityRequired: true,
    accessibilityFeatures: [{ name: 'Step-free access' }],
    accessibilityNotes: 'Wheelchair access',
  };
  const empty = { expectedAttendance: null, roomLayout: null, accessibilityRequired: null, accessibilityNotes: null };

  it("uses the event's for everything left empty, marked as the event's (TC-230-03)", () => {
    expect(venueRequirementsOf(empty, event)).toEqual({
      expectedAttendance: { value: 250, fromEvent: true },
      roomLayout: { value: 'theatre', fromEvent: true },
      accessibility: { required: true, features: [{ name: 'Step-free access' }], notes: 'Wheelchair access', fromEvent: true },
    });
  });

  it('uses its own where it has them (TC-230-01)', () => {
    const own = { expectedAttendance: 40, roomLayout: 'classroom', accessibilityRequired: true, accessibilityNotes: 'Hearing loop' };

    expect(venueRequirementsOf(own, event)).toEqual({
      expectedAttendance: { value: 40, fromEvent: false },
      roomLayout: { value: 'classroom', fromEvent: false },
      accessibility: { required: true, features: [], notes: 'Hearing loop', fromEvent: false },
    });
  });

  it("falls back field by field: own attendance, the event's layout and accessibility", () => {
    const result = venueRequirementsOf({ ...empty, expectedAttendance: 40 }, event);

    expect(result.expectedAttendance).toEqual({ value: 40, fromEvent: false });
    expect(result.roomLayout).toEqual({ value: 'theatre', fromEvent: true });
    expect(result.accessibility.fromEvent).toBe(true);
  });

  it('keeps an own "none needed" even when the event needs accessibility', () => {
    expect(venueRequirementsOf({ ...empty, accessibilityRequired: false }, event).accessibility).toEqual({
      required: false,
      features: [],
      notes: null,
      fromEvent: false,
    });
  });
});

describe('markIfEvents: shown as the event\'s (AC2)', () => {
  it("marks a value taken from the event (TC-230-03)", () => {
    expect(markIfEvents('250', { fromEvent: true })).toBe("250 (event's)");
  });

  it('leaves the request\'s own value unmarked (TC-230-01)', () => {
    expect(markIfEvents('40', { fromEvent: false })).toBe('40');
  });

  it('shows one the event never recorded as "Not specified" alone (SCRUM-143 AC4)', () => {
    expect(markIfEvents('Not specified', { fromEvent: true })).toBe('Not specified');
  });
});
