import { formatDayMonthYear, type ISODate } from '@/domain/shared/dates';
import { fromDatabaseTime, type ClockRange } from '@/domain/shared/times';
import type { EventVenue, FinalEventStatus, RegistrationPeriod } from './schema';

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

/** SCRUM-182 AC1, AC2: refused as full. */
export const NO_PLACES_REMAINING = 'There are no places remaining for this event.';

/**
 * SCRUM-180 AC1 — an event in one of these statuses is not going ahead, so it
 * is not open for registration whatever its period says (PO, 28/10/2026: read
 * "registration period is open" as also needing the event to be going ahead).
 * Both statuses are final. Restated in fetchOpenEvents' query, and the same
 * two that finalEventStatus (SCRUM-270) refuses registration for.
 */
export const FINAL_EVENT_STATUSES: readonly string[] = ['cancelled', 'completed'];

/**
 * SCRUM-180 AC1, AC2 — whether the event belongs on Open events today. The
 * same period rule the event page uses to offer the form (periodRefusalReason),
 * so the list never shows an event whose page then refuses. No period set
 * means registration has not opened; a Cancelled or Completed event is not
 * open at all.
 */
export function isOpenForRegistration(
  period: { startDate: ISODate | null; endDate: ISODate | null },
  eventStatus: string,
  today: ISODate,
): boolean {
  if (FINAL_EVENT_STATUSES.includes(eventStatus)) return false;
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
 * SCRUM-180 AC1, AC3 — the venues the event is held at: each venue with a
 * confirmed booking, once, in name order. An event can hold the same venue
 * twice on one day (a morning and an afternoon booking, which
 * venue_booking_no_overlap allows), so venues are told apart by venue_id, not
 * by booking; and by id, not name, since two venues may share a name. A
 * released booking (SCRUM-231) no longer holds the venue, so it is left out.
 */
export function bookedVenues(
  bookings: readonly { status: string; venue_id: string; venues: EventVenue | null }[],
): EventVenue[] {
  const byVenue = new Map<string, EventVenue>();
  for (const { status, venue_id, venues } of bookings) {
    if (status === 'confirmed' && venues) byVenue.set(venue_id, { name: venues.name, address: venues.address });
  }
  return [...byVenue.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * SCRUM-270 (bug against AC1) — whether the event is Cancelled or Completed.
 * Either way it is not going ahead, so it takes no registrations whatever its
 * period says (PO, 28/10/2026: a registration period is open only while the
 * event is going ahead). Every other status is null: the period and places
 * decide as before.
 *
 * The same two statuses as FINAL_EVENT_STATUSES (SCRUM-180), which keeps them
 * off Open events. Restated in SQL by register_for_event
 * (20261031034916_refuse_registration_final_event.sql), which checks it again
 * with the event row locked; change one, change the others.
 */
export function finalEventStatus(eventStatus: string): FinalEventStatus | null {
  return eventStatus === 'cancelled' || eventStatus === 'completed' ? eventStatus : null;
}

/** SCRUM-270: why a Cancelled or Completed event refuses a registration. */
export const FINAL_EVENT_REFUSALS: Record<FinalEventStatus, string> = {
  cancelled: 'This event has been cancelled, so it is not taking registrations.',
  completed: 'This event has already taken place, so it is not taking registrations.',
};

/**
 * SCRUM-182 AC1, AC3: whether the event is full. Only Registered
 * registrations count, so a withdrawal gives its place back (AC3).
 *
 * No capacity set is full: there is nothing to count against, so no place is
 * given (PO, 25/10/2026, TC-182-02). A capacity below the number registered is
 * full too, until enough withdraw to bring the count below it (TC-182-10).
 *
 * Restated in SQL by event_has_places_remaining
 * (20261025184920_event_registration_capacity.sql), which register_for_event
 * asks with the event row locked; change one, change the other.
 */
export function isEventFull(capacity: number | null, registeredCount: number): boolean {
  return capacity === null || registeredCount >= capacity;
}

/** SCRUM-184 AC1: only an active (Registered) registration can be withdrawn (TC-184-03). */
export const ALREADY_WITHDRAWN = 'This registration has already been withdrawn.';

/** SCRUM-184 AC3: refused once the event has taken place (TC-184-07, TC-184-08). */
export const EVENT_TAKEN_PLACE = 'This event has already taken place, so the registration can no longer be withdrawn.';

/**
 * SCRUM-184 AC1, AC3: whether a registration may still be withdrawn on
 * `today`. The event has taken place from its event date onwards, so the last
 * day to withdraw is the day before (PO, Slack 30/10/2026, CL-69). The event
 * date is the one the attendee sees on the registration page (proposed_date),
 * also for an event with several venue dates. An event with no date yet has not
 * taken place.
 *
 * Deliberately not hasEnded in src/domain/event-status/policy.ts: SCRUM-104
 * completes an event only once its end date has passed (CL-69).
 *
 * `today` is the Singapore date (todayInSingapore); `YYYY-MM-DD` sorts
 * lexicographically, so a string compare is a date compare.
 */
export function canWithdraw(eventDate: ISODate | null, today: ISODate): boolean {
  return eventDate === null || today < eventDate;
}
