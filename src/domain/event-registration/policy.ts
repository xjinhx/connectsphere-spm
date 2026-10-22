import { formatDayMonthYear, type ISODate } from '@/domain/shared/dates';
import type { RegistrationPeriod } from './schema';

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
 * (20261023001039_event_registration.sql), which checks it again with the
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
