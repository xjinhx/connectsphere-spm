import { describe, it, expect } from 'vitest';
import { CreateVenueHoldInputSchema } from '@/domain/venue-hold/schema';
import {
  canBeHeld,
  describeHeldPeriod,
  formatExpiry,
  futureExpiry,
  holdState,
  withoutOwnHolds,
} from '@/domain/venue-hold/policy';
import type { VenueCommitment } from '@/domain/availability/schema';
import { calendarDay } from '@/domain/venues/policy';
import { CALENDAR_PERIOD_LABELS } from '@/domain/venues/schema';

/**
 * SCRUM-227 Hold a venue until an expiry: the rules that need no database.
 * The save and the availability check are tests/integration/venue-hold.test.ts.
 *
 * AC text is from the Jira card (authoritative):
 *   AC1 "Given I choose an event, a venue, a date, a start and end time and an
 *        expiry date and time in the future, when I save, then the hold is
 *        recorded as active."
 *   AC2 "Given I leave the expiry empty or set it in the past, when I save,
 *        then the hold is refused and I am told a future expiry is required."
 *   AC5 "... when event A's request for that slot is approved, then a
 *        confirmed booking is created and the hold is closed."
 *   AC6 "Given a hold's expiry has passed without an approved booking ... then
 *        it is available again and the hold is never counted as a confirmed
 *        booking."
 *   AC7 "Given a start and end time has an active hold, when it is shown on
 *        the venue calendar with held period labelled Held with its expiry
 *        time."
 *
 * Test case IDs are from Joshua's Sprint 3 sheet (TC-227-nn).
 */

const EVENT_A = '11111111-1111-4111-8111-111111111111';
const EVENT_B = '22222222-2222-4222-8222-222222222222';
const VENUE = '33333333-3333-4333-8333-333333333333';

/** 10 Oct 2026, 12:00 in Singapore. */
const NOW = new Date('2026-10-10T12:00:00+08:00');

const validHold = () => ({ eventRequestId: EVENT_A, date: '2026-11-20', start: '10:00', end: '12:00', expiresAt: '2026-11-13T17:00' });

describe('CreateVenueHoldInputSchema: SCRUM-227 AC1', () => {
  it('TC-227-01 accepts an event, a date, 10:00-12:00 and an expiry', () => {
    expect(CreateVenueHoldInputSchema.safeParse(validHold()).success).toBe(true);
  });

  it('refuses an end time that is not after the start, naming both', () => {
    const result = CreateVenueHoldInputSchema.safeParse({ ...validHold(), start: '12:00', end: '10:00' });
    expect(result.success).toBe(false);
    expect(result.success ? {} : result.error.flatten().fieldErrors).toMatchObject({ start: expect.any(Array), end: expect.any(Array) });
  });

  it('refuses a time that is not on a 15-minute step', () => {
    expect(CreateVenueHoldInputSchema.safeParse({ ...validHold(), start: '10:10' }).success).toBe(false);
  });

  it('refuses an event that is not chosen from the list', () => {
    expect(CreateVenueHoldInputSchema.safeParse({ ...validHold(), eventRequestId: 'S227 A' }).success).toBe(false);
  });
});

describe('futureExpiry: SCRUM-227 AC1 and AC2', () => {
  it('TC-227-01 reads a Singapore date and time in the future', () => {
    expect(futureExpiry('2026-11-13T17:00', NOW)?.toISOString()).toBe('2026-11-13T09:00:00.000Z');
  });

  it('TC-227-02 accepts an expiry only minutes away', () => {
    expect(futureExpiry('2026-10-10T12:05', NOW)).not.toBeNull();
  });

  it('TC-227-03 refuses an empty expiry', () => {
    expect(futureExpiry(undefined, NOW)).toBeNull();
    expect(futureExpiry('', NOW)).toBeNull();
  });

  it('TC-227-04 refuses yesterday at 17:00', () => {
    expect(futureExpiry('2026-10-09T17:00', NOW)).toBeNull();
  });

  it('TC-227-05 refuses an expiry one minute before now', () => {
    expect(futureExpiry('2026-10-10T11:59', NOW)).toBeNull();
  });

  it('refuses an expiry equal to now: it is not in the future', () => {
    expect(futureExpiry('2026-10-10T12:00', NOW)).toBeNull();
  });

  it('refuses a date that does not exist, rather than rolling it into the next month', () => {
    expect(futureExpiry('2027-02-30T10:00', NOW)).toBeNull();
    expect(futureExpiry('2026-11-13T25:00', NOW)).toBeNull();
  });
});

describe('holdState: SCRUM-227 AC1, AC5, AC6', () => {
  const expiresAt = '2026-11-13T09:00:00.000Z';

  it('is active until its expiry', () => {
    expect(holdState({ status: 'active', expiresAt }, NOW)).toBe('active');
  });

  it('has lapsed once the expiry has passed (AC6)', () => {
    expect(holdState({ status: 'active', expiresAt }, new Date('2026-11-13T09:00:00.000Z'))).toBe('lapsed');
  });

  it('stays closed once its booking was confirmed, even after the expiry (AC5)', () => {
    expect(holdState({ status: 'closed', expiresAt }, new Date('2026-12-01T00:00:00Z'))).toBe('closed');
  });
});

describe('withoutOwnHolds: SCRUM-227 AC3 and AC5', () => {
  const commitment = (kind: VenueCommitment['kind'], eventRequestId: string | null): VenueCommitment => ({
    kind,
    venueId: VENUE,
    date: '2026-11-20',
    start: '10:00',
    end: '12:00',
    eventRequestId,
    reason: null,
  });

  it("drops the event's own hold, so the holder can request and be approved for it (AC5)", () => {
    expect(withoutOwnHolds([commitment('hold', EVENT_A)], EVENT_A)).toEqual([]);
  });

  it("keeps another event's hold, so event B is still refused (AC3, AC4)", () => {
    const held = commitment('hold', EVENT_A);
    expect(withoutOwnHolds([held], EVENT_B)).toEqual([held]);
  });

  it("keeps the event's own confirmed booking: only holds are the holder's to use", () => {
    const booked = commitment('booking', EVENT_A);
    expect(withoutOwnHolds([booked], EVENT_A)).toEqual([booked]);
  });
});

describe('naming a hold: SCRUM-227 AC4 and AC7', () => {
  it('formats the expiry in Singapore time', () => {
    expect(formatExpiry('2026-11-13T09:00:00.000Z')).toBe('13 Nov 2026 17:00');
  });

  it('TC-227-10 names the held period, the event holding it and the expiry', () => {
    expect(
      describeHeldPeriod(
        { date: '2026-11-20', start: '10:00', end: '12:00', expiresAt: '2026-11-13T09:00:00.000Z' },
        { reference: 'EVT-2026-0101', name: 'S227 A' },
      ),
    ).toBe('10:00-12:00 on 20 Nov 2026 is held for EVT-2026-0101 (S227 A) until 13 Nov 2026 17:00.');
  });
});

describe('calendarDay: SCRUM-227 AC7, a held period is labelled Held with its expiry', () => {
  const HOURS = { opensAt: '07:00', closesAt: '22:00' };
  const EXPIRY = '2026-11-13T09:00:00.000Z';

  it('TC-227-15 shows the held period with its exact times, labelled Held, with its expiry', () => {
    const day = calendarDay(
      '2026-11-20',
      HOURS,
      [{ kind: 'hold', date: '2026-11-20', start: '10:00', end: '12:00', eventRequestId: EVENT_A, reason: null, expiresAt: EXPIRY }],
      [],
      new Map(),
    );

    expect(day.periods).toEqual([{ kind: 'held', start: '10:00', end: '12:00', reason: null, event: null, expiresAt: EXPIRY }]);
    expect(CALENDAR_PERIOD_LABELS.held).toBe('Held');
    expect(formatExpiry(EXPIRY)).toBe('13 Nov 2026 17:00');
  });

  it('gives a confirmed or blocked period no expiry', () => {
    const day = calendarDay(
      '2026-11-20',
      HOURS,
      [
        { kind: 'booking', date: '2026-11-20', start: '08:00', end: '09:00', eventRequestId: EVENT_B, reason: null },
        { kind: 'unavailable', date: '2026-11-20', start: '13:00', end: '14:00', eventRequestId: null, reason: 'Repairs' },
      ],
      [],
      new Map(),
    );

    expect(day.periods.map((p) => 'expiresAt' in p)).toEqual([false, false]);
  });
});

describe('canBeHeld', () => {
  it('allows an Approved event or one in Planning, as a booking request does', () => {
    expect(canBeHeld('approved')).toBe(true);
    expect(canBeHeld('planning')).toBe(true);
  });

  it('refuses an event that is not yet approved, or is over', () => {
    for (const status of ['draft', 'submitted', 'rejected', 'confirmed', 'completed', 'cancelled']) {
      expect(canBeHeld(status)).toBe(false);
    }
  });
});
