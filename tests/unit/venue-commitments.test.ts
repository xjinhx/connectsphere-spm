import { describe, expect, it } from 'vitest';
import {
  ClockRangeSchema,
  datesBetween,
  isQuarterHourEnd,
  isQuarterHourStart,
  rangesOverlap,
  splitDateTime,
  toMinutes,
} from '@/domain/shared/times';
import { commitmentsOverlapping, toCommittedPeriods } from '@/domain/availability/policy';
import { getCommittedPeriods, getVenueCommitments } from '@/domain/availability/service';
import { VenueCommitmentSchema, type VenueCommitment } from '@/domain/availability/schema';

/**
 * SCRUM-239 Check venue availability in 15-minute time ranges (Jira,
 * authoritative). Test case IDs are from ConnectSphere_TestCases_Sprint3_238_239_226.xlsx.
 *
 * This file covers the shared contract only: clock times, the half-open
 * overlap rule, and the getVenueCommitments stub (D-16). Search, request,
 * approval and calendar are tested once they call it.
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

describe('getVenueCommitments stub (D-16)', () => {
  it('returns the fixture: the venue confirmed 10:00-12:00', async () => {
    const result = await getVenueCommitments(VENUE_A, '2026-11-10T09:00', '2026-11-10T13:00');
    expect(result).toEqual([
      expect.objectContaining({ kind: 'booking', venueId: VENUE_A, date: '2026-11-10', start: '10:00', end: '12:00' }),
    ]);
  });

  it('returns nothing for a range that only touches the booking', async () => {
    expect(await getVenueCommitments(VENUE_A, '2026-11-10T12:00', '2026-11-10T14:00')).toEqual([]);
  });

  it('returns one booking per date across a multi-day range, sorted by date', async () => {
    const result = await getVenueCommitments(VENUE_A, '2026-11-10T11:00', '2026-11-12T10:30');
    expect(result.map((c) => c.date)).toEqual(['2026-11-10', '2026-11-11', '2026-11-12']);
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

  it('getCommittedPeriods returns the stub booking as a bare period', async () => {
    expect(await getCommittedPeriods(VENUE_A, '2026-11-10T09:00', '2026-11-10T13:00')).toEqual([
      { date: '2026-11-10', start: '10:00', end: '12:00' },
    ]);
  });
});
