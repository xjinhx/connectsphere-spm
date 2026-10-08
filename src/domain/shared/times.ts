/**
 * Clock times on the 15-minute booking unit (customer change Week 7 #1,
 * forum #126, #128; "15 minutes" clarified in #131).
 *
 * A clock time is `HH:MM` in Singapore time, on :00, :15, :30 or :45.
 * `24:00` is the end of the day: it may end a range (a former Night slot is
 * 19:00-24:00, SCRUM-238 AC6) but never start one. Postgres `time` stores
 * 24:00:00, so the database can hold it as-is.
 *
 * Ranges are half-open, [start, end): a booking ending 12:00 does not overlap
 * one starting 12:00. SCRUM-239 AC2 depends on this - a venue booked
 * 10:00-12:00 is returned for a 12:00-14:00 search.
 */

/** `HH:MM`, Singapore time. */
export type ClockTime = string;

export const END_OF_DAY: ClockTime = '24:00';

const QUARTER_HOUR_PATTERN = /^([01]\d|2[0-3]):(00|15|30|45)$/;

/** True for a time a range may start at: 00:00 to 23:45 in 15-minute steps. */
export function isQuarterHourStart(value: string): boolean {
  return QUARTER_HOUR_PATTERN.test(value);
}

/** True for a time a range may end at: 00:15 to 24:00 in 15-minute steps. */
export function isQuarterHourEnd(value: string): boolean {
  return (QUARTER_HOUR_PATTERN.test(value) && value !== '00:00') || value === END_OF_DAY;
}

/** Minutes after midnight. `24:00` is 1440. */
export function toMinutes(time: ClockTime): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** A start and end time on one date. End is after start. */
export interface ClockRange {
  start: ClockTime;
  end: ClockTime;
}

/** Half-open overlap: touching ranges do not overlap. */
export function rangesOverlap(a: ClockRange, b: ClockRange): boolean {
  return toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end);
}

/** A Singapore date and clock time, `YYYY-MM-DDTHH:MM` (e.g. `2026-11-10T13:00`). */
export type SingaporeDateTime = string;

const DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

/** Splits a SingaporeDateTime into its date and clock time. Throws if malformed. */
export function splitDateTime(value: SingaporeDateTime): { date: string; time: ClockTime } {
  const match = DATE_TIME_PATTERN.exec(value);
  const [, date, time] = match ?? [];
  if (!date || !time) throw new Error(`Expected YYYY-MM-DDTHH:MM, got "${value}"`);
  return { date, time };
}

/** Every date from `from` to `to`, inclusive, as `YYYY-MM-DD`. */
export function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}
