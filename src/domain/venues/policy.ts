import { ValidationError } from '@/domain/shared/errors';
import { isActionPermitted } from '@/domain/identity/permissions';
import type { Role } from '@/domain/identity/roles';
import { toMinutes, type ClockRange, type ClockTime } from '@/domain/shared/times';
import type { CalendarSlotState, VenueLayoutInput } from './schema';

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
// SCRUM-123: the state of each slot on a venue's calendar
// -----------------------------------------------------------------------------

/** What was recorded against one slot on one date. */
export type CalendarSlotFacts = {
  operates: boolean;
  /** The reason a slot was recorded as unavailable, or null if it wasn't (AC7). */
  unavailableReason: string | null;
  confirmed: boolean;
  pendingRequests: number;
};

/**
 * The one state a slot is shown in. Where several things are recorded, the
 * first that applies wins:
 *
 * 1. Outside operating hours (AC3): the venue doesn't run the slot, so nothing
 *    else on it can matter.
 * 2. Blocked (AC7): Venue Staff have withdrawn it, even over a booking — the
 *    booking is then SCRUM-151's affected booking, not a working one.
 * 3. Confirmed (AC5).
 * 4. Pending request (AC6) — only when nothing is committed. A request on a
 *    confirmed slot leaves it Confirmed (AC8); the count is still carried on
 *    the slot so the calendar can show it beside the commitment.
 * 5. Available (AC2).
 */
export function calendarSlotState(facts: CalendarSlotFacts): CalendarSlotState {
  if (!facts.operates) return 'outside_operating_hours';
  if (facts.unavailableReason !== null) return 'blocked';
  if (facts.confirmed) return 'confirmed';
  if (facts.pendingRequests > 0) return 'pending_request';
  return 'available';
}

/**
 * Committed means the same here as in SCRUM-128's search: a confirmed booking
 * or a slot recorded as unavailable. A pending request never is (AC8), so the
 * calendar and the search can't disagree about a slot.
 */
export function isCommitted(state: CalendarSlotState): boolean {
  return state === 'confirmed' || state === 'blocked';
}

/**
 * AC4: "committed for all three slots" — read as every slot the venue runs
 * that day. For a venue open AM, PM and Night that is exactly the card's
 * wording; for one that runs AM and PM only, both booked leaves nothing to
 * request, so it is full too. A venue that runs no slot is never "full".
 */
export function isFullyCommitted(states: readonly CalendarSlotState[]): boolean {
  const operating = states.filter((state) => state !== 'outside_operating_hours');
  return operating.length > 0 && operating.every(isCommitted);
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
