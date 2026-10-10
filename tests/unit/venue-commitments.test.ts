import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ClockRangeSchema,
  datesBetween,
  isQuarterHourEnd,
  isQuarterHourStart,
  rangesOverlap,
  splitDateTime,
  toMinutes,
} from '@/domain/shared/times';
import { commitmentsInRange, commitmentsOverlapping, toCommittedPeriods } from '@/domain/availability/policy';
import { getCommittedPeriods, getVenueCommitments } from '@/domain/availability/service';
import { VenueCommitmentSchema, type VenueCommitment } from '@/domain/availability/schema';
import { fetchConfirmedBookingPeriods, fetchUnavailablePeriods } from '@/lib/supabase/availability';

// The database layer is replaced at its boundary; the service and policy run for real.
vi.mock('@/lib/supabase/availability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/availability')>()),
  fetchConfirmedBookingPeriods: vi.fn(),
  fetchUnavailablePeriods: vi.fn(),
}));

const ok = <T>(data: T) => ({ data, error: null }) as never;
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const bookingRow = (date: string, start: string, end: string) => ({
  venue_id: '11111111-1111-4111-8111-111111111111',
  event_request_id: EVENT_ID,
  date,
  start_time: `${start}:00`,
  end_time: `${end}:00`,
});

beforeEach(() => {
  vi.mocked(fetchConfirmedBookingPeriods).mockReset().mockResolvedValue(ok([]));
  vi.mocked(fetchUnavailablePeriods).mockReset().mockResolvedValue(ok([]));
});

/**
 * SCRUM-239 Check venue availability in 15-minute time ranges (Jira,
 * authoritative). Test case IDs are from ConnectSphere_TestCases_Sprint3_238_239_226.xlsx.
 *
 * This file covers the shared contract: clock times, the half-open overlap
 * rule, and getVenueCommitments with the database layer mocked. The same check
 * against a real database is tests/integration/venue-commitments.test.ts.
 * Search, request, approval and calendar are tested once they call it.
 */

const VENUE_A = '11111111-1111-4111-8111-111111111111';

const booking = (date: string, start: string, end: string): VenueCommitment => ({
  kind: 'booking',
  venueId: VENUE_A,
  date,
  start,
  end,
  eventRequestId: null,
  reason: null,
});

describe('clock times on the 15-minute unit', () => {
  it('accepts :00, :15, :30 and :45, and 24:00 only as an end', () => {
    expect(['00:00', '10:15', '23:45'].every(isQuarterHourStart)).toBe(true);
    expect(isQuarterHourStart('24:00')).toBe(false);
    expect(isQuarterHourEnd('24:00')).toBe(true);
    expect(isQuarterHourEnd('00:00')).toBe(false);
  });

  it('TC-239-02: refuses a time off the 15-minute step', () => {
    for (const time of ['08:10', '10:14', '10:16', '7:00', '10:15:00']) {
      expect(isQuarterHourStart(time)).toBe(false);
    }
  });

  it('counts 24:00 as the end of the day', () => {
    expect(toMinutes('24:00')).toBe(1440);
    expect(toMinutes('07:15')).toBe(435);
  });
});

describe('rangesOverlap: half-open ranges', () => {
  const booked = { start: '10:00', end: '12:00' };

  it('TC-239-05: a range starting as the booking ends does not overlap', () => {
    expect(rangesOverlap({ start: '12:00', end: '14:00' }, booked)).toBe(false);
  });

  it('TC-239-06: a range overlapping by one 15-minute step does', () => {
    expect(rangesOverlap({ start: '11:45', end: '13:00' }, booked)).toBe(true);
  });

  it('TC-239-07: a range ending as the booking starts does not overlap', () => {
    expect(rangesOverlap({ start: '08:00', end: '10:00' }, booked)).toBe(false);
  });
});

describe('commitmentsOverlapping', () => {
  const commitments = [booking('2026-11-10', '10:00', '12:00'), booking('2026-11-11', '10:00', '12:00')];

  it('TC-239-08: finds the 10:00-12:00 booking for an 11:00-13:00 request', () => {
    expect(commitmentsOverlapping(commitments, '2026-11-10', { start: '11:00', end: '13:00' })).toEqual([
      commitments[0],
    ]);
  });

  it('only looks at the date asked about', () => {
    expect(commitmentsOverlapping(commitments, '2026-11-12', { start: '10:00', end: '12:00' })).toEqual([]);
  });
});

describe('commitmentsInRange', () => {
  const commitments = [
    booking('2026-11-11', '10:00', '12:00'),
    booking('2026-11-10', '14:00', '15:00'),
    booking('2026-11-10', '10:00', '12:00'),
    booking('2026-11-12', '10:00', '12:00'),
  ];

  it('keeps only what overlaps the window, half-open (TC-239-05, 06)', () => {
    expect(commitmentsInRange(commitments, '2026-11-10T12:00', '2026-11-10T14:00')).toEqual([]);
    expect(commitmentsInRange(commitments, '2026-11-10T11:45', '2026-11-10T13:00')).toEqual([commitments[2]]);
  });

  it('opens on the first date at the start time and closes on the last at the end time', () => {
    const result = commitmentsInRange(commitments, '2026-11-10T13:00', '2026-11-12T10:30');
    expect(result.map((c) => `${c.date} ${c.start}`)).toEqual(['2026-11-10 14:00', '2026-11-11 10:00', '2026-11-12 10:00']);
  });
});

describe('getVenueCommitments (SCRUM-239, replaces D-16)', () => {
  it('returns confirmed bookings and unavailable periods as commitments, times as HH:MM', async () => {
    vi.mocked(fetchConfirmedBookingPeriods).mockResolvedValue(ok([bookingRow('2026-11-10', '10:00', '12:00')]));
    vi.mocked(fetchUnavailablePeriods).mockResolvedValue(
      ok([{ venue_id: VENUE_A, date: '2026-11-10', start_time: '14:00:00', end_time: '16:30:00', reason: 'Ceiling repair' }]),
    );

    const result = await getVenueCommitments(VENUE_A, '2026-11-10T08:00', '2026-11-10T22:00');

    expect(result).toEqual([
      { kind: 'booking', venueId: VENUE_A, date: '2026-11-10', start: '10:00', end: '12:00', eventRequestId: EVENT_ID, reason: null },
      { kind: 'unavailable', venueId: VENUE_A, date: '2026-11-10', start: '14:00', end: '16:30', eventRequestId: null, reason: 'Ceiling repair' },
    ]);
    expect(fetchConfirmedBookingPeriods).toHaveBeenCalledWith(VENUE_A, '2026-11-10', '2026-11-10');
  });

  it('TC-239-05: a booking that only touches the range is not returned', async () => {
    vi.mocked(fetchConfirmedBookingPeriods).mockResolvedValue(ok([bookingRow('2026-11-10', '10:00', '12:00')]));
    expect(await getVenueCommitments(VENUE_A, '2026-11-10T12:00', '2026-11-10T14:00')).toEqual([]);
  });

  it('reads a 24:00:00 end as 24:00 (former Night slot)', async () => {
    vi.mocked(fetchUnavailablePeriods).mockResolvedValue(
      ok([{ venue_id: VENUE_A, date: '2026-11-10', start_time: '19:00:00', end_time: '24:00:00', reason: 'Event setup' }]),
    );
    const [period] = await getVenueCommitments(VENUE_A, '2026-11-10T20:00', '2026-11-10T21:00');
    expect(period).toMatchObject({ start: '19:00', end: '24:00' });
  });

  it('fails clearly when the database cannot be read', async () => {
    vi.mocked(fetchConfirmedBookingPeriods).mockResolvedValue({ data: null, error: { message: 'boom' } } as never);
    await expect(getVenueCommitments(VENUE_A, '2026-11-10T08:00', '2026-11-10T22:00')).rejects.toThrow(
      "Could not check the venue's availability.",
    );
  });
});

describe('helpers', () => {
  it('splits a Singapore date-time and refuses a malformed one', () => {
    expect(splitDateTime('2026-11-10T13:00')).toEqual({ date: '2026-11-10', time: '13:00' });
    expect(() => splitDateTime('2026-11-10 13:00')).toThrow();
  });

  it('lists every date in a range, across a month end', () => {
    expect(datesBetween('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });
});

describe('ClockRangeSchema: the shared input schema', () => {
  const pathsOf = (input: unknown) => {
    const result = ClockRangeSchema.safeParse(input);
    return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
  };

  it('accepts a range on the 15-minute unit, including 24:00 as the end', () => {
    expect(ClockRangeSchema.safeParse({ start: '11:30', end: '13:30' }).success).toBe(true);
    expect(ClockRangeSchema.safeParse({ start: '19:00', end: '24:00' }).success).toBe(true);
  });

  it('accepts the shortest range, one 15-minute step (TC-238-17)', () => {
    expect(ClockRangeSchema.safeParse({ start: '10:00', end: '10:15' }).success).toBe(true);
  });

  it('refuses a time off the 15-minute step (TC-238-08, TC-238-19)', () => {
    expect(pathsOf({ start: '10:10', end: '12:00' })).toContain('start');
    expect(pathsOf({ start: '10:15', end: '12:14' })).toContain('end');
  });

  it('refuses 24:00 as a start', () => {
    expect(pathsOf({ start: '24:00', end: '24:00' })).toContain('start');
  });

  it('flags both fields when the end is not after the start (TC-238-04, TC-238-05)', () => {
    expect(pathsOf({ start: '14:00', end: '14:00' })).toEqual(['start', 'end']);
    expect(pathsOf({ start: '15:00', end: '13:30' })).toEqual(['start', 'end']);
  });

  it('refuses a missing time', () => {
    expect(ClockRangeSchema.safeParse({ start: '10:00' }).success).toBe(false);
  });
});

describe('review fixes (PR #88)', () => {
  it('toMinutes throws on a time that is not on the 15-minute unit, instead of returning NaN', () => {
    for (const bad of ['10:10', '1000', 'ab:cd', '', '25:00', '10:15:00']) {
      expect(() => toMinutes(bad)).toThrow();
    }
  });

  it('so a malformed commitment makes the overlap check fail loudly, never read as free', () => {
    expect(() => rangesOverlap({ start: '10:00', end: '12:00' }, { start: 'ab:cd', end: '12:00' })).toThrow();
  });

  it('ClockRangeSchema still returns an error, not a throw, for an off-step time', () => {
    expect(() => ClockRangeSchema.safeParse({ start: '10:10', end: '10:10' })).not.toThrow();
    expect(ClockRangeSchema.safeParse({ start: '10:10', end: '10:10' }).success).toBe(false);
  });

  it('VenueCommitmentSchema refuses a commitment whose times are off the 15-minute unit', () => {
    const commitment = { ...booking('2026-11-10', '10:00', '12:00'), start: '10:05' };
    expect(VenueCommitmentSchema.safeParse(commitment).success).toBe(false);
  });

  it('toCommittedPeriods keeps the period only: no event id, no reason (SCRUM-239 AC3, SCRUM-226 AC4)', () => {
    const withDetails: VenueCommitment = {
      ...booking('2026-11-10', '10:00', '12:00'),
      eventRequestId: '22222222-2222-4222-8222-222222222222',
    };
    const blocked: VenueCommitment = { ...booking('2026-11-10', '14:00', '16:30'), kind: 'unavailable', reason: 'Ceiling repair' };

    const periods = toCommittedPeriods([blocked, withDetails]);

    expect(periods).toEqual([
      { date: '2026-11-10', start: '10:00', end: '12:00' },
      { date: '2026-11-10', start: '14:00', end: '16:30' },
    ]);
    expect(JSON.stringify(periods)).not.toMatch(/2222|Ceiling|eventRequestId|reason|kind/);
  });

  it('getCommittedPeriods returns real bookings as bare periods, with no event id', async () => {
    vi.mocked(fetchConfirmedBookingPeriods).mockResolvedValue(ok([bookingRow('2026-11-10', '10:00', '12:00')]));
    const periods = await getCommittedPeriods(VENUE_A, '2026-11-10T09:00', '2026-11-10T13:00');
    expect(periods).toEqual([{ date: '2026-11-10', start: '10:00', end: '12:00' }]);
    expect(JSON.stringify(periods)).not.toContain(EVENT_ID);
  });
});
