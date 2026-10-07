import { describe, it, expect } from 'vitest';
import {
  calendarSlotState,
  canViewVenueCatalogue,
  datesInRange,
  isCommitted,
  isFullyCommitted,
  type CalendarSlotFacts,
} from '@/domain/venues/policy';
import { CALENDAR_MAX_DAYS, VenueCalendarQuerySchema, daysInRange } from '@/domain/venues/schema';

/**
 * SCRUM-123 View a venue's calendar with the state of each slot — the pure
 * rules. tests/integration/venue-calendar.test.ts runs the same criteria
 * against Postgres.
 *
 * AC1 "... each date shows its AM, PM and Night slots with the current state of each."
 * AC2 open, nothing recorded → available.
 * AC3 outside operating hours, cannot be requested.
 * AC4 committed for all three slots → fully committed.
 * AC5 confirmed booking → Confirmed. AC6 pending request → Pending request.
 * AC7 recorded unavailable → Blocked, with the reason.
 * AC8 a second request on a confirmed slot is a pending request, not a commitment.
 * AC9 Event Organiser or Attendee → denied. AC10 four internal roles → displayed.
 *
 * Test case IDs are from Self_Owned_ScrumsTest.xlsx, sheet SCRUM-123.
 */

const facts = (over: Partial<CalendarSlotFacts> = {}): CalendarSlotFacts => ({
  operates: true,
  unavailableReason: null,
  confirmed: false,
  pendingRequests: 0,
  ...over,
});

describe('VenueCalendarQuerySchema: SCRUM-123 AC1, a date range', () => {
  it('TC-123-01: accepts a five-day range', () => {
    expect(VenueCalendarQuerySchema.safeParse({ from: '2026-12-01', to: '2026-12-05' }).success).toBe(true);
  });

  it('TC-123-02: accepts a single-day range', () => {
    expect(VenueCalendarQuerySchema.safeParse({ from: '2026-12-02', to: '2026-12-02' }).success).toBe(true);
  });

  it('TC-123-03: refuses a range that ends before it starts', () => {
    const result = VenueCalendarQuerySchema.safeParse({ from: '2026-12-03', to: '2026-12-01' });
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.to).toEqual(['The end date cannot be before the start date.']);
  });

  it('TC-123-04: refuses a range longer than 31 days, and accepts exactly 31', () => {
    const over = VenueCalendarQuerySchema.safeParse({ from: '2026-12-04', to: '2027-01-04' });
    expect(over.success).toBe(false);
    expect(over.error?.flatten().fieldErrors.to).toEqual([`A calendar can show at most ${CALENDAR_MAX_DAYS} days.`]);
    expect(VenueCalendarQuerySchema.safeParse({ from: '2026-12-04', to: '2027-01-03' }).success).toBe(true);
  });

  it('refuses a missing, malformed or impossible date', () => {
    expect(VenueCalendarQuerySchema.safeParse({ to: '2026-12-05' }).success).toBe(false);
    expect(VenueCalendarQuerySchema.safeParse({ from: '01/12/2026', to: '2026-12-05' }).success).toBe(false);
    expect(VenueCalendarQuerySchema.safeParse({ from: '2026-02-30', to: '2026-03-02' }).success).toBe(false);
  });

  it('counts days with both ends included, across a month end', () => {
    expect(daysInRange('2026-12-01', '2026-12-01')).toBe(1);
    expect(daysInRange('2026-12-30', '2027-01-02')).toBe(4);
    expect(datesInRange('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });
});

describe('calendarSlotState: SCRUM-123 AC2, AC3, AC5 to AC8', () => {
  it('TC-123-05: open with nothing recorded is available (AC2)', () => {
    expect(calendarSlotState(facts())).toBe('available');
  });

  it('TC-123-06 / TC-123-07: a slot the venue does not run is outside operating hours (AC3)', () => {
    expect(calendarSlotState(facts({ operates: false }))).toBe('outside_operating_hours');
    // Nothing recorded on a closed slot can make it look requestable.
    expect(calendarSlotState(facts({ operates: false, unavailableReason: 'Repairs', confirmed: true }))).toBe(
      'outside_operating_hours',
    );
  });

  it('TC-123-10: a confirmed booking is Confirmed (AC5)', () => {
    expect(calendarSlotState(facts({ confirmed: true }))).toBe('confirmed');
  });

  it('TC-123-11: a pending request on a free slot is Pending request (AC6)', () => {
    expect(calendarSlotState(facts({ pendingRequests: 1 }))).toBe('pending_request');
  });

  it('TC-123-12: a slot recorded as unavailable is Blocked, even over a booking (AC7)', () => {
    expect(calendarSlotState(facts({ unavailableReason: 'Annual maintenance' }))).toBe('blocked');
    expect(calendarSlotState(facts({ unavailableReason: 'Annual maintenance', confirmed: true }))).toBe('blocked');
  });

  it('TC-123-13: a second request on a confirmed slot leaves it Confirmed (AC8)', () => {
    expect(calendarSlotState(facts({ confirmed: true, pendingRequests: 1 }))).toBe('confirmed');
  });
});

describe('isFullyCommitted: SCRUM-123 AC4 and AC8', () => {
  it('TC-123-08: committed in all three slots is fully committed (AC4)', () => {
    expect(isFullyCommitted(['confirmed', 'confirmed', 'confirmed'])).toBe(true);
  });

  it('TC-123-09: committed in two of three is not (AC4)', () => {
    expect(isFullyCommitted(['confirmed', 'confirmed', 'available'])).toBe(false);
  });

  it('TC-123-14: a pending request does not make a date fully committed (AC8)', () => {
    expect(isCommitted('pending_request')).toBe(false);
    expect(isFullyCommitted(['confirmed', 'confirmed', 'pending_request'])).toBe(false);
  });

  it('counts a Blocked slot as committed, the same as SCRUM-128 search does', () => {
    expect(isFullyCommitted(['confirmed', 'blocked', 'confirmed'])).toBe(true);
  });

  it('judges only the slots the venue runs', () => {
    expect(isFullyCommitted(['confirmed', 'confirmed', 'outside_operating_hours'])).toBe(true);
    expect(isFullyCommitted(['outside_operating_hours', 'outside_operating_hours', 'outside_operating_hours'])).toBe(false);
  });
});

describe('who may view a venue calendar: SCRUM-123 AC9 and AC10', () => {
  it('TC-123-15 / TC-123-16: Event Organisers and Attendees may not (AC9)', () => {
    expect(canViewVenueCatalogue(['event_organiser'])).toBe(false);
    expect(canViewVenueCatalogue(['attendee'])).toBe(false);
  });

  it('TC-123-17 to TC-123-20: Coordinators, Venue Staff, Technical Support and Operations Managers may (AC10)', () => {
    expect(canViewVenueCatalogue(['coordinator'])).toBe(true);
    expect(canViewVenueCatalogue(['venue_staff'])).toBe(true);
    expect(canViewVenueCatalogue(['technical_support'])).toBe(true);
    expect(canViewVenueCatalogue(['operations_manager'])).toBe(true);
  });
});
