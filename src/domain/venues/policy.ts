import { ValidationError } from '@/domain/shared/errors';
import { toMinutes, type ClockRange, type ClockTime } from '@/domain/shared/times';
import { isActionPermitted } from '@/domain/identity/permissions';
import type { Role } from '@/domain/identity/roles';
import { OPERATING_SLOTS, type CalendarSlotState, type OperatingSlot, type VenueLayoutInput } from './schema';

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
// update_venue (supabase/migrations/20261010120000_...) applies the same rule
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
// SCRUM-128: is a venue free in the searched slots
// -----------------------------------------------------------------------------

/** A booked or withdrawn slot, read for one date. Slot text is as stored. */
export type SlotCommitment = { venueId: string; slot: string };

/**
 * The slots each venue is committed in on the searched date.
 *
 * Committed means a confirmed booking (AC2, AC3) or a slot recorded as
 * unavailable (AC4). A pending booking request is not a commitment — SCRUM-123
 * AC8 says so outright — so it is never passed in here.
 *
 * AC3 is applied as the card writes it: a booking commits its own slots and no
 * others, so an AM booking leaves the PM slot free. That is the team's Week 7
 * decision for this sprint ("build as carded"). The customer's W7-1 and W7-4
 * changes — setup and turnaround time in minutes per venue, and tentative holds
 * that expire — go to SCRUM-226 (turnaround) and SCRUM-227 (holds). They should
 * use SCRUM-225's occupied time rather than add a copy of it here.
 */
export function committedSlotsByVenue(commitments: SlotCommitment[]): Map<string, Set<OperatingSlot>> {
  const byVenue = new Map<string, Set<OperatingSlot>>();
  for (const { venueId, slot } of commitments) {
    const known = OPERATING_SLOTS.find((s) => s === slot);
    if (!known) continue;
    const slots = byVenue.get(venueId) ?? new Set<OperatingSlot>();
    slots.add(known);
    byVenue.set(venueId, slots);
  }
  return byVenue;
}

/**
 * AC1: a venue is returned only if it is free in every one of the selected
 * slots, and excluded if it is committed in any one of them.
 *
 * A slot the venue doesn't run (venues.operating_slots, SCRUM-116 AC4) is not
 * free either: SCRUM-123 AC3 shows it as "outside operating hours and cannot be
 * requested", and the story is to find venues "that could actually host it".
 */
export function isFreeInEverySlot(
  operatingSlots: readonly string[],
  searchedSlots: readonly OperatingSlot[],
  committed: ReadonlySet<OperatingSlot> | undefined,
): boolean {
  return searchedSlots.every((slot) => operatingSlots.includes(slot) && !committed?.has(slot));
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
