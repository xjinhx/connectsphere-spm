import { describe, it, expect } from 'vitest';
import {
  calendarDay,
  canViewVenueCatalogue,
  coversOpeningHours,
  datesInRange,
  type CalendarCommitmentInput,
} from '@/domain/venues/policy';
import { CALENDAR_MAX_DAYS, VenueCalendarQuerySchema, daysInRange } from '@/domain/venues/schema';

/**
 * SCRUM-239 AC5 View a venue's calendar in exact time ranges — the pure rules.
 * tests/integration/venue-calendar.test.ts runs the same criteria against
 * Postgres.
 *
 * AC5 (Jira): "Given I view a venue's calendar for a day, when it loads, then
 * confirmed, pending, held and blocked periods each show with their exact
 * start and end times, and no fixed lunch or dinner gap is drawn."
 *
 * SCRUM-123's rules (Done on slots) carry over in time ranges and keep their
 * test case IDs as regression checks: AC1 the date range, AC4 fully committed,
 * AC7 a Blocked period's reason, AC8 a pending request is not a commitment,
 * AC9/AC10 who may view.
 *
 * Test case IDs: TC-239-xx from ConnectSphere_TestCases_Sprint3_238_239_226.xlsx;
 * TC-123-xx from Self_Owned_ScrumsTest.xlsx, sheet SCRUM-123.
 */

const DATE = '2026-11-10';
const HOURS = { opensAt: '08:00', closesAt: '22:00' };
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const EVENT = { id: EVENT_ID, reference: 'EVT-2026-0001', name: 'Annual Dinner' };

const commitment = (over: Partial<CalendarCommitmentInput>): CalendarCommitmentInput => ({
  kind: 'booking',
  date: DATE,
  start: '10:00',
  end: '12:00',
  eventRequestId: EVENT_ID,
  reason: null,
  ...over,
});

const NO_EVENTS = new Map();

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

describe('calendarDay: SCRUM-239 AC5, periods with exact times', () => {
  it('TC-239-12: shows confirmed, pending, held and blocked periods each with their exact times, in time order', () => {
    const day = calendarDay(
      DATE,
      HOURS,
      [
        commitment({ kind: 'unavailable', start: '15:00', end: '16:30', eventRequestId: null, reason: 'Ceiling repair' }),
        commitment({ kind: 'booking', start: '08:00', end: '10:00' }),
        commitment({ kind: 'hold', start: '13:00', end: '14:00', eventRequestId: null }),
      ],
      [{ date: DATE, start: '10:30', end: '11:15' }],
      NO_EVENTS,
    );
    expect(day.periods.map((p) => `${p.start}-${p.end} ${p.kind}`)).toEqual([
      '08:00-10:00 confirmed',
      '10:30-11:15 pending',
      '13:00-14:00 held',
      '15:00-16:30 blocked',
    ]);
  });

  it('TC-239-13: draws a booking across the old lunch break as one period, with no gap', () => {
    const day = calendarDay(DATE, HOURS, [commitment({ start: '11:30', end: '13:30' })], [], NO_EVENTS);
    expect(day.periods).toEqual([{ kind: 'confirmed', start: '11:30', end: '13:30', reason: null, event: null }]);
  });

  it('shows only the given date', () => {
    const day = calendarDay(DATE, HOURS, [commitment({ date: '2026-11-11' })], [{ date: '2026-11-11', start: '09:00', end: '10:00' }], NO_EVENTS);
    expect(day.periods).toEqual([]);
  });

  it('TC-123-12: a Blocked period carries its reason; nothing else does', () => {
    const day = calendarDay(
      DATE,
      HOURS,
      [commitment({}), commitment({ kind: 'unavailable', start: '14:00', end: '16:30', eventRequestId: null, reason: 'Ceiling repair' })],
      [],
      NO_EVENTS,
    );
    expect(day.periods.map((p) => p.reason)).toEqual([null, 'Ceiling repair']);
  });

  it('SCRUM-148 AC3: names the event on a Confirmed period only when the viewer may see it', () => {
    const visible = new Map([[`${DATE}|${EVENT_ID}`, EVENT]]);
    expect(calendarDay(DATE, HOURS, [commitment({})], [], visible).periods[0]?.event).toEqual(EVENT);
    expect(calendarDay(DATE, HOURS, [commitment({})], [], NO_EVENTS).periods[0]?.event).toBeNull();
  });

  it('TC-123-13: a pending request on a confirmed period is shown beside it, not instead of it (AC8)', () => {
    const day = calendarDay(DATE, HOURS, [commitment({})], [{ date: DATE, start: '10:00', end: '12:00' }], NO_EVENTS);
    expect(day.periods.map((p) => p.kind)).toEqual(['confirmed', 'pending']);
  });
});

describe('fully committed: SCRUM-123 AC4 in time ranges', () => {
  it('TC-123-08: committed periods covering the whole opening hours make the day fully committed', () => {
    const day = calendarDay(
      DATE,
      HOURS,
      [
        commitment({ start: '08:00', end: '12:00' }),
        commitment({ kind: 'unavailable', start: '12:00', end: '17:00', eventRequestId: null, reason: 'Repair' }),
        commitment({ kind: 'hold', start: '17:00', end: '22:00', eventRequestId: null }),
      ],
      [],
      NO_EVENTS,
    );
    expect(day.fullyCommitted).toBe(true);
  });

  it('TC-123-09: a 15-minute gap anywhere leaves the day not fully committed', () => {
    expect(
      coversOpeningHours(
        [
          { start: '08:00', end: '12:00' },
          { start: '12:15', end: '22:00' },
        ],
        HOURS,
      ),
    ).toBe(false);
  });

  it('TC-123-14: a pending request does not count towards fully committed (AC8)', () => {
    const day = calendarDay(DATE, HOURS, [commitment({ start: '08:00', end: '20:00' })], [{ date: DATE, start: '20:00', end: '22:00' }], NO_EVENTS);
    expect(day.fullyCommitted).toBe(false);
  });

  it('copes with overlapping commitments and ones outside the opening hours', () => {
    expect(
      coversOpeningHours(
        [
          { start: '07:00', end: '13:00' },
          { start: '10:00', end: '23:00' },
        ],
        HOURS,
      ),
    ).toBe(true);
    expect(coversOpeningHours([], HOURS)).toBe(false);
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
