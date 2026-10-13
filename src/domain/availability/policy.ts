import type { OperatingSlot } from '@/domain/venues/schema';
import { formatSingaporeDate, type ISODate } from '@/domain/shared/dates';
import { END_OF_DAY, rangesOverlap, splitDateTime, toMinutes, type ClockRange, type SingaporeDateTime } from '@/domain/shared/times';
import { SLOT_NAMES, type CommittedPeriod, type VenueCommitment } from './schema';

/**
 * Venue availability rules. Pure functions: no Supabase, no Next.js.
 */

/**
 * SCRUM-151 AC1: only a slot the venue operates can be withdrawn. A slot it
 * does not operate is never offered in the first place (SCRUM-116 AC4), so
 * marking it unavailable would record nothing real. CONTEXT.md keeps the two
 * apart: "not operating" is a permanent setting, "unavailable" is one date.
 *
 * Returns the chosen slots the venue does not operate, in the order chosen.
 */
export function findNonOperatingSlots(
  chosen: readonly OperatingSlot[],
  operating: readonly OperatingSlot[],
): OperatingSlot[] {
  return chosen.filter((slot) => !operating.includes(slot));
}

/**
 * SCRUM-151 AC2: what the coordinator of an affected booking is told: which of
 * the booking's slots were withdrawn, and why.
 */
export function affectedBookingMessage(
  venueName: string,
  date: ISODate,
  slots: readonly OperatingSlot[],
  reason: string,
): string {
  const names = slots.map((slot) => SLOT_NAMES[slot]).join(' + ');
  return `Your booking at ${venueName} is affected: ${formatSingaporeDate(date)} ${names} is no longer available (${reason}).`;
}

/**
 * SCRUM-239: the commitments on one date that overlap a requested range.
 * Half-open, so a range that only touches a commitment is free (AC2:
 * 12:00-14:00 is free next to a 10:00-12:00 booking; 11:45-13:00 is not).
 *
 * Not a clash check on its own: it knows nothing of the venue's setup and
 * turnaround (SCRUM-226, committed time), so it cannot see that a 13:00 start needs setting
 * up from 12:30. To ask whether a booking would clash, call getVenueCommitments
 * with the range itself and treat any result as a clash.
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
