import { ValidationError } from '@/domain/shared/errors';
import { isActionPermitted } from '@/domain/identity/permissions';
import type { Role } from '@/domain/identity/roles';
import { toMinutes, type ClockRange, type ClockTime } from '@/domain/shared/times';
import {
  CALENDAR_PERIOD_KINDS,
  OPERATING_SLOTS,
  type CalendarDay,
  type CalendarPeriod,
  type OperatingSlot,
  type VenueLayoutInput,
} from './schema';

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
