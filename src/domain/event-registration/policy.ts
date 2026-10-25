import { formatDayMonthYear, type ISODate } from '@/domain/shared/dates';
import { fromDatabaseTime, type ClockRange } from '@/domain/shared/times';
import type { EventVenue, RegistrationPeriod } from './schema';

/**
 * SCRUM-181 — Register for an event. Pure rules only; service.ts applies them.
 */

export type PeriodRefusalReason = 'not_started' | 'ended';

/**
 * AC2, AC3, AC4: whether `today` falls in the registration period. Both dates
 * are inclusive, so registering on the start date or the end date succeeds.
 * `today` is the Singapore date (todayInSingapore), so 00:15 on the start date
 * is already open and 00:15 the day after the end date is already closed,
 * whatever the server's own zone (TC-181-13).
 *
 * `YYYY-MM-DD` sorts lexicographically, so a string compare is a date compare.
 *
 * Restated in SQL by register_for_event
 * (20261024130843_event_registration.sql), which checks it again with the
 * event row locked; change one, change the other.
 */
export function periodRefusalReason(period: RegistrationPeriod, today: ISODate): PeriodRefusalReason | null {
  if (today < period.startDate) return 'not_started';
  if (today > period.endDate) return 'ended';
  return null;
}

/** AC2: the start date is shown, as DD/MM/YYYY. */
export function notStartedMessage(period: RegistrationPeriod): string {
  return `Registration opens on ${formatDayMonthYear(period.startDate)}.`;
}

/** AC3: the end date is shown, as DD/MM/YYYY. */
export function endedMessage(period: RegistrationPeriod): string {
  return `Registration closed on ${formatDayMonthYear(period.endDate)}.`;
}

/** Why registering is refused today (AC2, AC3), or null while the period is open (AC4). */
export function registrationPeriodRefusal(period: RegistrationPeriod, today: ISODate): string | null {
  const reason = periodRefusalReason(period, today);
  if (reason === 'not_started') return notStartedMessage(period);
  if (reason === 'ended') return endedMessage(period);
  return null;
}

/** AC5: the second registration is refused; the existing one is shown alongside. */
export const ALREADY_REGISTERED = 'You are already registered for this event.';

/** Refusing a full event is SCRUM-182's; register_for_event can already say so. */
export const NO_PLACES_REMAINING = 'There are no places remaining for this event.';

/**
 * SCRUM-180 AC1, AC2 — whether the event belongs on Open events today. The
 * same rule the event page uses to offer the form (periodRefusalReason), so
 * the list never shows an event whose page then refuses. No period set means
 * registration has not opened.
 */
export function isOpenForRegistration(
  period: { startDate: ISODate | null; endDate: ISODate | null },
  today: ISODate,
): boolean {
  if (!period.startDate || !period.endDate) return false;
  return periodRefusalReason({ startDate: period.startDate, endDate: period.endDate }, today) === null;
}

/**
 * SCRUM-180 AC6 — whether My registrations marks the event Cancelled. Only the
 * Cancelled status does: any other status, Confirmed and Preparation included,
 * is shown unmarked.
 */
export function isEventCancelled(eventStatus: string): boolean {
  return eventStatus === 'cancelled';
}

/** SCRUM-180 AC1 — the event's start and end times, or null until both are set. */
export function eventTimes(startTime: string | null, endTime: string | null): ClockRange | null {
  if (!startTime || !endTime) return null;
  return { start: fromDatabaseTime(startTime), end: fromDatabaseTime(endTime) };
}

/**
 * SCRUM-180 AC1, AC3 — the venues the event is held at: one per confirmed
 * booking, in name order. A released booking (SCRUM-231) no longer holds the
 * venue, so it is left out.
 */
export function bookedVenues(
  bookings: readonly { status: string; venues: EventVenue | null }[],
): EventVenue[] {
  return bookings
    .flatMap(({ status, venues }) =>
      status === 'confirmed' && venues ? [{ name: venues.name, address: venues.address }] : [],
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}
