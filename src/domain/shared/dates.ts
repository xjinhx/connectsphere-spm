/**
 * Calendar dates and Singapore-time rendering.
 *
 * ConnectSphere operates in Singapore, so "today" is a Singapore question, not
 * a server question: at 23:00 UTC the server is still on the previous day while
 * Singapore has already moved on. Deciding "is this date in the past?" against
 * the server clock would reject a valid date for eight hours a day.
 */

export const SINGAPORE_TIME_ZONE = 'Asia/Singapore';

/** A calendar date in `YYYY-MM-DD` form, with no time and no zone. */
export type ISODate = string;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True for a well-formed date that actually exists - 2026-02-30 does not. */
export function isISODate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * The latest date a form accepts. A browser date input lets a person type up
 * to six digits of year (20266), and the schema refuses anything past this.
 */
export const LATEST_DATE: ISODate = '9999-12-31';

/** True when a date input's value has a year of more than four digits, e.g. "20266-10-10". */
export function hasLongYear(value: string): boolean {
  return /^\d{5,}-/.test(value);
}

export function todayInSingapore(now: Date = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SINGAPORE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const valueOf = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${valueOf('year')}-${valueOf('month')}-${valueOf('day')}`;
}

/**
 * The Singapore calendar date an instant falls on.
 *
 * The shared event-request schema parses `proposedDate` with `z.coerce.date()`,
 * which turns "2026-11-15" into midnight UTC - 8am in Singapore, so the same
 * day. Anything carrying a real time-of-day late in the UTC day would land on
 * the following Singapore date, which is correct, but worth knowing.
 */
export function toSingaporeISODate(instant: Date): ISODate {
  return todayInSingapore(instant);
}

/** `YYYY-MM-DD` sorts lexicographically, so a string compare is a date compare. */
export function isPastDate(date: ISODate, today: ISODate = todayInSingapore()): boolean {
  return date < today;
}

/**
 * The Singapore wall-clock time an instant falls at, in minutes after
 * midnight (0-1439).
 *
 * Exists for comparing "now" against a request's start time (SCRUM-238 AC5,
 * which keeps SCRUM-210's fix) - the same server-clock-vs-Singapore problem
 * todayInSingapore() solves for calendar dates, one level down. Replaces
 * currentHourInSingapore(), which compared against a slot's end hour.
 */
export function currentMinutesInSingapore(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SINGAPORE_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const valueOf = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return valueOf('hour') * 60 + valueOf('minute');
}

/** e.g. "17 Sep 2026". */
export function formatSingaporeDate(date: ISODate): string {
  // Anchored at Singapore midnight, so formatting it back in Singapore returns
  // the same calendar day rather than slipping to its neighbour.
  const instant = new Date(`${date}T00:00:00+08:00`);
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: SINGAPORE_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(instant);
}

/**
 * e.g. "10/11/2026": DD/MM/YYYY, the format agreed at Sprint 4 Planning.
 * Rearranges the calendar date as it is; no time zone involved.
 */
export function formatDayMonthYear(date: ISODate): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

/** e.g. "10 Sep 2026, 7:15 pm GMT+8" - the zone is shown so AC#5 is visible. */
export function formatSingaporeDateTime(instant: Date | string): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: SINGAPORE_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(date);
}
