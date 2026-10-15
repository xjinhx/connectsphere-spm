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
import {
  fetchConfirmedBookingPeriods,
  fetchUnavailablePeriods,
  fetchVenueSetupTurnaround,
} from '@/lib/supabase/availability';
import { fetchActiveHoldPeriods } from '@/lib/supabase/venueHolds';

// The database layer is replaced at its boundary; the service and policy run for real.
vi.mock('@/lib/supabase/availability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/availability')>()),
  fetchConfirmedBookingPeriods: vi.fn(),
  fetchUnavailablePeriods: vi.fn(),
  fetchVenueSetupTurnaround: vi.fn(),
}));

// SCRUM-227: getVenueCommitments also reads active holds; replaced the same way,
// so this file never needs a database.
vi.mock('@/lib/supabase/venueHolds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/venueHolds')>()),
  fetchActiveHoldPeriods: vi.fn(),
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
  vi.mocked(fetchActiveHoldPeriods).mockReset().mockResolvedValue(ok([]));
  // The default for every venue (PO, 8 Oct 2026): no setup, no turnaround.
  vi.mocked(fetchVenueSetupTurnaround)
    .mockReset()
    .mockResolvedValue(ok({ setup_minutes: 0, turnaround_minutes: 0 }));
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

  it('SCRUM-227: returns an active hold as kind hold, with its event and expiry', async () => {
    vi.mocked(fetchActiveHoldPeriods).mockResolvedValue(
      ok([
        {
          venue_id: VENUE_A,
          event_request_id: EVENT_ID,
          date: '2026-11-10',
          start_time: '10:00:00',
          end_time: '12:00:00',
          expires_at: '2026-11-03T09:00:00+00:00',
        },
      ]),
    );
    const now = new Date('2026-10-10T04:00:00Z');

    expect(await getVenueCommitments(VENUE_A, '2026-11-10T08:00', '2026-11-10T22:00', now)).toEqual([
      {
        kind: 'hold',
        venueId: VENUE_A,
        date: '2026-11-10',
        start: '10:00',
        end: '12:00',
        eventRequestId: EVENT_ID,
        reason: null,
        expiresAt: '2026-11-03T09:00:00.000Z',
      },
    ]);
    // Only holds that have not expired at `now` are asked for (AC6).
    expect(fetchActiveHoldPeriods).toHaveBeenCalledWith(VENUE_A, '2026-11-10', '2026-11-10', now.toISOString());
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

// -----------------------------------------------------------------------------
// SCRUM-226 — Treat setup and turnaround time as occupied (committed)
// Card example: 30 min setup, 45 min turnaround, confirmed 10 Nov 2026
// 10:00-12:00, so committed 09:30-12:45. IDs from the SCRUM-226 tab.
// -----------------------------------------------------------------------------

describe('getVenueCommitments: SCRUM-226 setup and turnaround are committed', () => {
  const DAY = '2026-11-10';
  const at = (time: string) => `${DAY}T${time}`;
  /** A booking for [start, end) at the card's venue clashes with something. */
  const clashes = async (start: string, end: string) =>
    (await getVenueCommitments(VENUE_A, at(start), at(end))).length > 0;

  beforeEach(() => {
    vi.mocked(fetchVenueSetupTurnaround).mockResolvedValue(ok({ setup_minutes: 30, turnaround_minutes: 45 }));
    vi.mocked(fetchConfirmedBookingPeriods).mockResolvedValue(ok([bookingRow(DAY, '10:00', '12:00')]));
  });

  it('TC-226-01 / 03 / 04 (AC1-AC3): 12:30-14:00 clashes with the committed 09:30-12:45', async () => {
    expect(await clashes('12:30', '14:00')).toBe(true);
  });

  it('TC-226-04 (AC3): the clashing booking is identified for Venue Staff', async () => {
    const [clash] = await getVenueCommitments(VENUE_A, at('12:30'), at('14:00'));
    expect(clash).toMatchObject({ kind: 'booking', eventRequestId: EVENT_ID });
  });

  it('TC-226-05 (AC4): the day shows 09:30-12:45, setup and turnaround included', async () => {
    expect(await getCommittedPeriods(VENUE_A, at('00:00'), at('24:00'))).toEqual([
      { date: DAY, start: '09:30', end: '12:45' },
    ]);
  });

  it('TC-226-06 (AC4): the periods a coordinator sees carry no event details', async () => {
    const [period] = await getCommittedPeriods(VENUE_A, at('00:00'), at('24:00'));
    expect(Object.keys(period ?? {}).sort()).toEqual(['date', 'end', 'start']);
  });

  it('TC-226-07..10 (AC5): 13:15 is free - its own 30 min setup starts at 12:45', async () => {
    expect(await clashes('13:15', '14:30')).toBe(false);
  });

  it('TC-226-07..10 (AC5): 13:00 is refused - its setup would start at 12:30, in the turnaround', async () => {
    expect(await clashes('13:00', '14:30')).toBe(true);
  });

  it('applies the new booking\'s turnaround too: an earlier booking must clear the next setup', async () => {
    // Ends 08:45 + 45 min turnaround = 09:30, exactly when the 10:00 booking's setup starts.
    expect(await clashes('07:00', '08:45')).toBe(false);
    expect(await clashes('07:00', '09:00')).toBe(true);
  });

  it('does not widen an unavailable period: nothing is set up for a withdrawn period', async () => {
    vi.mocked(fetchConfirmedBookingPeriods).mockResolvedValue(ok([]));
    vi.mocked(fetchUnavailablePeriods).mockResolvedValue(
      ok([{ venue_id: VENUE_A, date: DAY, start_time: '14:00:00', end_time: '16:30:00', reason: 'Repairs' }]),
    );
    expect(await getCommittedPeriods(VENUE_A, at('00:00'), at('24:00'))).toEqual([
      { date: DAY, start: '14:00', end: '16:30' },
    ]);
  });

  describe('TC-226-21: a hold is widened like the booking it stands in for', () => {
    const now = new Date('2026-10-10T04:00:00Z');
    beforeEach(() => {
      vi.mocked(fetchConfirmedBookingPeriods).mockResolvedValue(ok([]));
      vi.mocked(fetchActiveHoldPeriods).mockResolvedValue(
        ok([
          {
            venue_id: VENUE_A,
            event_request_id: EVENT_ID,
            date: DAY,
            start_time: '10:00:00',
            end_time: '12:00:00',
            expires_at: '2026-11-03T09:00:00+00:00',
          },
        ]),
      );
    });

    it('returns a 10:00-12:00 hold as 09:30-12:45, still a hold with its event and expiry', async () => {
      const [hold] = await getVenueCommitments(VENUE_A, at('00:00'), at('24:00'), now);
      expect(hold).toMatchObject({
        kind: 'hold',
        start: '09:30',
        end: '12:45',
        eventRequestId: EVENT_ID,
        expiresAt: '2026-11-03T09:00:00.000Z',
      });
    });

    it("refuses 13:00 (its setup falls in the hold's turnaround) and allows 13:15", async () => {
      expect((await getVenueCommitments(VENUE_A, at('13:00'), at('14:30'), now)).length).toBe(1);
      expect((await getVenueCommitments(VENUE_A, at('13:15'), at('14:30'), now)).length).toBe(0);
    });
  });

  it('changes nothing for a venue with no setup and no turnaround (the default)', async () => {
    vi.mocked(fetchVenueSetupTurnaround).mockResolvedValue(ok({ setup_minutes: 0, turnaround_minutes: 0 }));
    expect(await clashes('12:00', '14:00')).toBe(false);
    expect(await clashes('11:45', '13:00')).toBe(true);
  });

  it('keeps the widened window inside the day', async () => {
    vi.mocked(fetchConfirmedBookingPeriods).mockResolvedValue(ok([bookingRow(DAY, '00:30', '01:00')]));
    expect(await clashes('00:15', '00:30')).toBe(true);
    expect(await getCommittedPeriods(VENUE_A, at('00:00'), at('24:00'))).toEqual([
      { date: DAY, start: '00:00', end: '01:45' },
    ]);
  });

  it('refuses to answer when the venue cannot be read, rather than calling it free', async () => {
    vi.mocked(fetchVenueSetupTurnaround).mockResolvedValue({ data: null, error: { message: 'boom' } } as never);
    await expect(getVenueCommitments(VENUE_A, at('12:30'), at('14:00'))).rejects.toThrow(
      "Could not check the venue's availability.",
    );
  });
});
