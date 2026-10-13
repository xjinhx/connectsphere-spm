import { formatSingaporeDate, type ISODate } from '@/domain/shared/dates';
import { END_OF_DAY, formatClockRange, rangesOverlap, splitDateTime, toMinutes, type ClockRange, type SingaporeDateTime } from '@/domain/shared/times';
import type { CommittedPeriod, VenueCommitment } from './schema';

/**
 * Venue availability rules. Pure functions: no Supabase, no Next.js.
 */

/**
 * SCRUM-151 AC2, by time (SCRUM-239 AC6): what the coordinator of an affected
 * booking is told: the period withdrawn at the venue, and why.
 */
export function affectedBookingMessage(venueName: string, date: ISODate, period: ClockRange, reason: string): string {
  return `Your booking at ${venueName} is affected: ${formatSingaporeDate(date)} ${formatClockRange(period)} is no longer available (${reason}).`;
}

/**
 * SCRUM-239: the commitments on one date that overlap a requested range.
 * Half-open, so a range that only touches a commitment is free (AC2:
 * 12:00-14:00 is free next to a 10:00-12:00 booking; 11:45-13:00 is not).
 */
export function commitmentsOverlapping(
  commitments: readonly VenueCommitment[],
  date: ISODate,
  range: ClockRange,
): VenueCommitment[] {
  return commitments.filter((c) => c.date === date && rangesOverlap(c, range));
}

/**
 * SCRUM-239 AC3, SCRUM-226 AC4: commitments reduced to their periods, so no
 * other event's id or reason can reach a coordinator or organiser. Sorted by
 * date then start time; two commitments with the same period become one.
 */
export function toCommittedPeriods(commitments: readonly VenueCommitment[]): CommittedPeriod[] {
  const seen = new Set<string>();
  const periods: CommittedPeriod[] = [];
  for (const { date, start, end } of commitments) {
    const key = `${date} ${start} ${end}`;
    if (!seen.has(key)) {
      seen.add(key);
      periods.push({ date, start, end });
    }
  }
  return periods.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}

/**
 * SCRUM-239: the commitments that overlap [start, end), where start and end
 * are Singapore date-times and may fall on different dates. On the first date
 * the window opens at the start time, on the last it closes at the end time,
 * and any date in between counts whole. Sorted by date, then start time.
 */
export function commitmentsInRange(
  commitments: readonly VenueCommitment[],
  start: SingaporeDateTime,
  end: SingaporeDateTime,
): VenueCommitment[] {
  const from = splitDateTime(start);
  const to = splitDateTime(end);
  return commitments
    .filter((c) => c.date >= from.date && c.date <= to.date)
    .filter((c) => {
      const window: ClockRange = {
        start: c.date === from.date ? from.time : '00:00',
        end: c.date === to.date ? to.time : END_OF_DAY,
      };
      return rangesOverlap(c, window);
    })
    .sort((a, b) => a.date.localeCompare(b.date) || toMinutes(a.start) - toMinutes(b.start));
}
