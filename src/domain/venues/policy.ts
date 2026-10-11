import { ValidationError } from '@/domain/shared/errors';
import { isActionPermitted } from '@/domain/identity/permissions';
import type { Role } from '@/domain/identity/roles';
import { toMinutes, type ClockRange, type ClockTime } from '@/domain/shared/times';
import { CALENDAR_PERIOD_KINDS, type CalendarDay, type CalendarPeriod, type VenueLayoutInput } from './schema';

/**
 * Venue Catalogue business rules. Pure functions: no Supabase, no Next.js.
 *
 * Single-field rules (capacity is a positive whole number, at least one slot)
 * live in schema.ts. This file holds the rules that compare values against
 * each other, plus who may do what.
 */

// -----------------------------------------------------------------------------
// SCRUM-118: layout capacity versus venue maximum
// -----------------------------------------------------------------------------

/**
 * Returns the layouts whose capacity is above the venue's maximum.
 * Equal is allowed: 200 against a maximum of 200 passes (SCRUM-118 AC4),
 * 201 against 200 does not (SCRUM-118 AC3).
 */
export function findLayoutsOverMaxCapacity(maxCapacity: number, layouts: VenueLayoutInput[]): VenueLayoutInput[] {
  return layouts.filter((layout) => layout.capacity > maxCapacity);
}

/**
 * Throws if any layout capacity is above the venue maximum.
 *
 * Call this on create, and on update whenever either the maximum capacity or
 * the layouts change, using the values the venue will have AFTER the update.
 * That way lowering a venue from 200 to 150 is refused while a 200-seat layout
 * still exists.
 */
export function assertLayoutsWithinMaxCapacity(maxCapacity: number, layouts: VenueLayoutInput[]): void {
  const overCapacity = findLayoutsOverMaxCapacity(maxCapacity, layouts);
  if (overCapacity.length > 0) {
    throw new ValidationError('Layout capacity cannot exceed the venue maximum.', {
      maxCapacity,
      layouts: overCapacity,
    });
  }
}

// -----------------------------------------------------------------------------
// SCRUM-120 AC2 and AC3: which bookings a capacity cut affects
//
// update_venue (supabase/migrations/20260924170000_...) applies the same two
// rules inside the save, so the check and the write agree.
// -----------------------------------------------------------------------------

/** Only a lower maximum can affect a booking. Raising it, or saving it unchanged, never asks. */
export function isCapacityCut(currentMaxCapacity: number, proposedMaxCapacity: number): boolean {
  return proposedMaxCapacity < currentMaxCapacity;
}

/**
 * A booking is affected when its expected attendance is above the new maximum.
 * Equal is not affected: 100 against 99 is (AC2), 100 against 100 is not (AC3).
 * A booking with no expected attendance recorded cannot be over any maximum.
 */
export function isAffectedByCapacity(expectedAttendance: number | null, maxCapacity: number): boolean {
  return expectedAttendance !== null && expectedAttendance > maxCapacity;
}

// -----------------------------------------------------------------------------
// SCRUM-225: setup and turnaround around a booking
//
// update_venue (supabase/migrations/20261011193000_...) applies the same rule
// inside the save, so the list the editor confirms and the check agree.
// -----------------------------------------------------------------------------

/** A venue's setup and turnaround, in minutes (SCRUM-225 AC1). */
export type SetupTurnaround = { setupMinutes: number; turnaroundMinutes: number };

/**
 * The time a booking commits its venue for, in minutes after midnight: from
 * its start minus the venue's setup to its end plus its turnaround. Half-open,
 * like every range (src/domain/shared/times.ts).
 *
 * Numbers rather than clock times, because setup can reach back before 00:00
 * and turnaround past 24:00, which no clock time can say.
 *
 * The rule SCRUM-226 applies wherever availability is checked ("one rule,
 * SCRUM-225's committed time"); this story uses it to find the bookings a
 * change would make clash.
 */
export function committedMinutes(range: ClockRange, { setupMinutes, turnaroundMinutes }: SetupTurnaround) {
  return { start: toMinutes(range.start) - setupMinutes, end: toMinutes(range.end) + turnaroundMinutes };
}

/** Whether two bookings' committed times overlap. Touching does not: 10:00-13:00 leaves 13:00 free. */
export function committedTimesOverlap(a: ClockRange, b: ClockRange, times: SetupTurnaround): boolean {
  const first = committedMinutes(a, times);
  const second = committedMinutes(b, times);
  return first.start < second.end && second.start < first.end;
}

/** A confirmed booking as SCRUM-225's check reads it: its event, date and times. */
export type DatedBooking = { bookingId: string; eventId: string; date: string; start: ClockTime; end: ClockTime };

/**
 * SCRUM-225 AC4: the bookings a change from `current` to `proposed` setup and
 * turnaround makes clash, in the order they were given.
 *
 * A booking is listed when its committed time overlaps another booking's on
 * the same date with the proposed values but did not with the current ones:
 * - only the change is judged, so bookings that already clashed are not
 *   listed again;
 * - an event's own bookings never clash with each other: one event using a
 *   room 10:00-12:00 and 13:00-15:00 does not need it reset in between;
 * - both bookings of a clashing pair are listed (AC4: "both bookings are
 *   listed").
 *
 * Which bookings to pass in (confirmed, from today on) is the caller's choice;
 * a pending request commits nothing.
 */
export function findNewSetupTurnaroundClashes<T extends DatedBooking>(
  bookings: readonly T[],
  current: SetupTurnaround,
  proposed: SetupTurnaround,
): T[] {
  const clashing = new Set<string>();
  for (const [index, a] of bookings.entries()) {
    for (const b of bookings.slice(index + 1)) {
      if (a.date !== b.date || a.eventId === b.eventId) continue;
      if (committedTimesOverlap(a, b, proposed) && !committedTimesOverlap(a, b, current)) {
        clashing.add(a.bookingId);
        clashing.add(b.bookingId);
      }
    }
  }
  return bookings.filter((booking) => clashing.has(booking.bookingId));
}

// -----------------------------------------------------------------------------
// SCRUM-239: is a period inside a venue's opening hours
// -----------------------------------------------------------------------------

/**
 * SCRUM-239 AC1: "a request outside those hours is refused, and search does
 * not return that venue for it". The whole period must sit inside the venue's
 * opening hours; touching either end is fine (half-open ranges).
 *
 * Opening hours come from venues.opens_at / closes_at, filled from the
 * operating slots by the time-model migration until Venue Staff set them.
 */
export function isWithinOpeningHours(period: ClockRange, hours: { opensAt: ClockTime; closesAt: ClockTime }): boolean {
  return toMinutes(period.start) >= toMinutes(hours.opensAt) && toMinutes(period.end) <= toMinutes(hours.closesAt);
}

// -----------------------------------------------------------------------------
// SCRUM-239 AC5: the periods on a venue's calendar
// -----------------------------------------------------------------------------

/** A committed period on one date, as getVenueCommitments returns it, plus the event behind a booking. */
export type CalendarCommitmentInput = {
  kind: 'booking' | 'hold' | 'unavailable';
  date: string;
  start: ClockTime;
  end: ClockTime;
  eventRequestId: string | null;
  reason: string | null;
};

/** A pending booking request line on one date. */
export type CalendarPendingInput = { date: string; start: ClockTime; end: ClockTime };

/** The event behind a confirmed booking, keyed `${date}|${eventRequestId}`, only where the viewer may see it. */
export type VisibleEvents = ReadonlyMap<string, { id: string; reference: string; name: string }>;

const KIND_OF: Record<CalendarCommitmentInput['kind'], CalendarPeriod['kind']> = {
  booking: 'confirmed',
  hold: 'held',
  unavailable: 'blocked',
};

/**
 * SCRUM-123 AC4 in time ranges: the committed periods leave no gap anywhere
 * in the opening hours. A pending request is never a commitment (SCRUM-123
 * AC8), so only confirmed, held and blocked periods count.
 */
export function coversOpeningHours(
  committed: readonly ClockRange[],
  hours: { opensAt: ClockTime; closesAt: ClockTime },
): boolean {
  let reached = toMinutes(hours.opensAt);
  const closes = toMinutes(hours.closesAt);
  for (const period of [...committed].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))) {
    if (toMinutes(period.start) > reached) break;
    reached = Math.max(reached, toMinutes(period.end));
    if (reached >= closes) return true;
  }
  return reached >= closes;
}

/**
 * SCRUM-239 AC5: one date on the calendar. Every confirmed, pending, held and
 * blocked period shows with its exact start and end time, in start order; no
 * fixed lunch or dinner gap is drawn because nothing here knows about slots.
 */
export function calendarDay(
  date: string,
  hours: { opensAt: ClockTime; closesAt: ClockTime },
  commitments: readonly CalendarCommitmentInput[],
  pending: readonly CalendarPendingInput[],
  visibleEvents: VisibleEvents,
): CalendarDay {
  const committed: CalendarPeriod[] = commitments
    .filter((c) => c.date === date)
    .map((c) => ({
      kind: KIND_OF[c.kind],
      start: c.start,
      end: c.end,
      reason: c.kind === 'unavailable' ? c.reason : null,
      event: c.kind === 'booking' && c.eventRequestId ? (visibleEvents.get(`${date}|${c.eventRequestId}`) ?? null) : null,
    }));
  const requested: CalendarPeriod[] = pending
    .filter((p) => p.date === date)
    .map((p) => ({ kind: 'pending', start: p.start, end: p.end, reason: null, event: null }));

  const kindOrder = CALENDAR_PERIOD_KINDS;
  const periods = [...committed, ...requested].sort(
    (a, b) =>
      toMinutes(a.start) - toMinutes(b.start) ||
      toMinutes(a.end) - toMinutes(b.end) ||
      kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind),
  );
  return { date, fullyCommitted: coversOpeningHours(committed, hours), periods };
}

/** Every date from `from` to `to`, both included, as YYYY-MM-DD. */
export function datesInRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const day = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (day <= end) {
    dates.push(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return dates;
}

// -----------------------------------------------------------------------------
// Permissions
//
// Both read from the team's permission matrix (SCRUM-69,
// src/domain/identity/permissions.ts) instead of listing roles here, so there
// is one place that decides who may do what. These wrappers exist so pages can
// ask a readable question when deciding what to render; route handlers call
// assertPermission with the same action names.
// -----------------------------------------------------------------------------

/** SCRUM-116, 117, 118, 120: only Venue Staff maintain the catalogue. */
export function canManageVenues(roles: Role[]): boolean {
  return isActionPermitted(roles, 'venue_administration');
}

/**
 * SCRUM-121: internal staff may browse the catalogue.
 * Event Organisers and Attendees are not given catalogue access in Release 1,
 * because the stories only name Coordinators and Venue Staff.
 */
export function canViewVenueCatalogue(roles: Role[]): boolean {
  return isActionPermitted(roles, 'venue_catalogue_view');
}
