import { describe, expect, it } from 'vitest';
import {
  datesBetween,
  isQuarterHourEnd,
  isQuarterHourStart,
  rangesOverlap,
  splitDateTime,
  toMinutes,
} from '@/domain/shared/times';
import { commitmentsOverlapping } from '@/domain/availability/policy';
import { getVenueCommitments } from '@/domain/availability/service';
import type { VenueCommitment } from '@/domain/availability/schema';

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
