import { TIME_SLOT_ORDER, type EventRequestStatus, type TimeSlot } from '@/domain/event-request/schema';
import { isActionPermitted } from '@/domain/identity/permissions';
import type { Role } from '@/domain/identity/roles';
import { formatSingaporeDate } from '@/domain/shared/dates';
import type { VenueBookingRequestLineStatus, VenueBookingRequestStatus } from './schema';
import { describeAccessibility } from '@/domain/event-request/policy';
import { ROOM_LAYOUT_LABELS, RoomLayoutSchema } from '@/domain/venues/schema';

/**
 * SCRUM-142 — Submit a venue booking request for an event.
 *
 * AC1 (Jira, updated 29/9/2026): "Given I am the assigned coordinator of an
 * event that is Approved or in Planning, when I submit a booking request...
 * then the request is created with status Pending...". This is now the
 * confirmed card text, not an inference.
 *
 * Scope note (also confirmed 29/9/2026): this ticket's job stops at
 * creating the Pending request — it does not cover how the resulting status
 * is displayed (SCRUM-99, "See the current status of an event") or the
 * Venue Staff-facing queue page itself (SCRUM-147, "View the pending booking
 * request queue"). Both are separate tickets; this one only needs the row to
 * exist and be readable by that role.
 */
export function canCreateBookingRequest(status: EventRequestStatus): boolean {
  return status === 'approved' || status === 'planning';
}

// ---------------------------------------------------------------------------
// SCRUM-154 — Block a booking request that clashes with a booking or an
// unavailable slot
// ---------------------------------------------------------------------------

/** A venue's slot on one date, as stored: a confirmed booking or an unavailable slot. */
export type DatedSlot = { date: string; slot: string };

/**
 * One requested date where at least one slot cannot be had. `committed` holds
 * a confirmed booking (AC1, AC3), `unavailable` a slot Venue Staff withdrew
 * (AC4); `available` is every other slot asked for on that date (AC3).
 *
 * It carries slots only, never who holds them: AC1 says no event name, client
 * organisation, coordinator or status of the other booking is shown.
 */
export interface SlotClash {
  date: string;
  committed: TimeSlot[];
  unavailable: TimeSlot[];
  available: TimeSlot[];
}

/**
 * AC1 to AC5: the requested dates that clash, and how.
 *
 * Slots are compared one by one on the same date, so an AM booking leaves PM
 * free (AC2, AC5), and a clash on one date says nothing about another. A
 * pending booking request commits nothing, so only confirmed bookings are
 * passed in. A slot that is both booked and unavailable is reported as
 * committed.
 */
export function findSlotClashes(
  lines: readonly { date: string; timeSlots: readonly TimeSlot[] }[],
  confirmed: readonly DatedSlot[],
  unavailable: readonly DatedSlot[],
): SlotClash[] {
  const holds = (list: readonly DatedSlot[], date: string, slot: TimeSlot) =>
    list.some((row) => row.date === date && row.slot === slot);

  const clashes: SlotClash[] = [];
  for (const line of lines) {
    const asked = TIME_SLOT_ORDER.filter((slot) => line.timeSlots.includes(slot));
    const committed = asked.filter((slot) => holds(confirmed, line.date, slot));
    const withdrawn = asked.filter((slot) => !committed.includes(slot) && holds(unavailable, line.date, slot));
    if (committed.length === 0 && withdrawn.length === 0) continue;
    clashes.push({
      date: line.date,
      committed,
      unavailable: withdrawn,
      available: asked.filter((slot) => !committed.includes(slot) && !withdrawn.includes(slot)),
    });
  }
  return clashes;
}

const SLOT_NAMES: Record<TimeSlot, string> = { am: 'AM', pm: 'PM', night: 'Night' };

function slotNames(slots: readonly TimeSlot[]): string {
  const names = slots.map((slot) => SLOT_NAMES[slot]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? '');
}

/**
 * The refusal the coordinator reads: per date, which slots are committed or
 * unavailable and which are still available (AC1, AC3, AC4).
 */
export function describeSlotClashes(clashes: readonly SlotClash[]): string {
  const parts = clashes.map((clash) => {
    const reasons = [
      clash.committed.length > 0 && `${slotNames(clash.committed)} already committed`,
      clash.unavailable.length > 0 && `${slotNames(clash.unavailable)} unavailable`,
    ].filter(Boolean);
    const free =
      clash.available.length > 0 ? `; ${slotNames(clash.available)} still available` : '';
    return `${clash.date}: ${reasons.join(', ')}${free}`;
  });
  return `This venue cannot be requested for those slots. ${parts.join('. ')}.`;
}

// ---------------------------------------------------------------------------
// SCRUM-148 — Approve a booking request
// ---------------------------------------------------------------------------

/**
 * AC1 and AC5: a request's status from its lines' decisions.
 *
 * Any line still pending: Pending. Every line approved: Approved (AC1). Every
 * line rejected: Rejected. A mix: Partially Approved (AC5).
 */
export function requestStatusOf(lineStatuses: readonly VenueBookingRequestLineStatus[]): VenueBookingRequestStatus {
  if (lineStatuses.length === 0 || lineStatuses.includes('pending')) return 'pending';
  if (lineStatuses.every((status) => status === 'approved')) return 'approved';
  if (lineStatuses.every((status) => status === 'rejected')) return 'rejected';
  return 'partially_approved';
}

/**
 * AC3 and AC4: who sees a booked slot's event on the venue calendar.
 *
 * Venue Staff (venue_administration), Event Operations Managers
 * (coordinator_assignment) and the event's own assigned coordinator see the
 * event (AC3). Every other internal user sees only that the slot is committed
 * (AC4). The same "role and relationship to the event" rule as customer
 * clarification #91 and the review reads.
 */
export function canSeeBookingDetails(
  actor: { userId: string; roles: readonly Role[] },
  eventCoordinatorId: string | null,
): boolean {
  return (
    isActionPermitted(actor.roles, 'venue_administration') ||
    isActionPermitted(actor.roles, 'coordinator_assignment') ||
    (eventCoordinatorId !== null && eventCoordinatorId === actor.userId)
  );
}

/**
 * AC2: what the event's coordinator is told when their booking request is
 * decided: the outcome, the dates and slots, and each rejected line's reason.
 */
export function bookingDecisionMessage(
  venueName: string,
  decision: {
    status: VenueBookingRequestStatus;
    lines: readonly {
      date: string;
      timeSlots: readonly string[];
      status: VenueBookingRequestLineStatus;
      rejectionReason: string | null;
    }[];
  },
): string {
  const when = (line: { date: string; timeSlots: readonly string[] }) =>
    `${formatSingaporeDate(line.date)} ${line.timeSlots.map((slot) => SLOT_NAMES[slot as TimeSlot] ?? slot).join(' + ')}`;
  const approved = decision.lines.filter((line) => line.status === 'approved').map(when);
  const rejected = decision.lines
    .filter((line) => line.status === 'rejected')
    .map((line) => `${when(line)} (${line.rejectionReason ?? ''})`);
  const request = `Your booking request for ${venueName}`;
  if (rejected.length === 0) return `${request} was approved: ${approved.join(', ')}.`;
  if (approved.length === 0) return `${request} was rejected: ${rejected.join('; ')}.`;
  return `${request} was partially approved. Approved: ${approved.join(', ')}. Rejected: ${rejected.join('; ')}.`;
}

// ---------------------------------------------------------------------------
// SCRUM-147 — View the pending booking request queue
// ---------------------------------------------------------------------------

export const BOOKING_QUEUE_SORTS = ['requested', 'event-date'] as const;
export type BookingQueueSort = (typeof BOOKING_QUEUE_SORTS)[number];

/** A sort named in the URL, or the default when it is missing or unknown. */
export function toBookingQueueSort(value: unknown): BookingQueueSort {
  return BOOKING_QUEUE_SORTS.find((sort) => sort === value) ?? 'requested';
}

/**
 * The order the queue is shown in.
 *
 * 'requested' (the default; the card sets none): the oldest request first, so
 *   Venue Staff work through requests in the order they arrived.
 * 'event-date' (AC2): the soonest requested event date first. Dates are
 *   compared as YYYY-MM-DD strings, which order the same way as the calendar,
 *   never as displayed text ("2 Jan 2027" would sort before "30 Dec 2026").
 *
 * Ties fall back to the other order, then the line id, so the result is stable.
 * Returns a new array; the input is not reordered in place.
 */
export function sortBookingQueue<T extends { lineId: string; date: string; requestedAt: string }>(
  entries: readonly T[],
  sort: BookingQueueSort,
): T[] {
  const byRequestedAt = (a: T, b: T) => Date.parse(a.requestedAt) - Date.parse(b.requestedAt);
  const byDate = (a: T, b: T) => a.date.localeCompare(b.date);
  const byLine = (a: T, b: T) => a.lineId.localeCompare(b.lineId);
  const order: Record<BookingQueueSort, (a: T, b: T) => number> = {
    requested: (a, b) => byRequestedAt(a, b) || byDate(a, b) || byLine(a, b),
    'event-date': (a, b) => byDate(a, b) || byRequestedAt(a, b) || byLine(a, b),
  };
  return [...entries].sort(order[sort]);
}

// ---------------------------------------------------------------------------
// SCRUM-143 — Include the requirements Venue Staff need
// ---------------------------------------------------------------------------
// AC2: attendance, layout and accessibility needs are shown as recorded on the
// event. AC4: a layout or accessibility need that was never recorded reads
// "Not specified", never a blank. A recorded "no accessibility needs" is an
// answer, so it reads "None required" (AC2), not "Not specified".

export const NOT_SPECIFIED = 'Not specified';

/** AC2, AC4 — the event's expected attendance. */
export function describeAttendanceForVenueStaff(expectedAttendance: number | null): string {
  return expectedAttendance === null ? NOT_SPECIFIED : String(expectedAttendance);
}

/** AC2, AC4 — the event's required layout, in the catalogue's own words. */
export function describeLayoutForVenueStaff(roomLayout: string | null): string {
  const layout = RoomLayoutSchema.safeParse(roomLayout);
  return layout.success ? ROOM_LAYOUT_LABELS[layout.data] : NOT_SPECIFIED;
}

/** AC2, AC4 — the event's accessibility needs: the features and notes, "None required", or not specified. */
export function describeAccessibilityForVenueStaff(event: {
  accessibilityRequired: boolean | null;
  accessibilityFeatures: readonly { name: string }[];
  accessibilityNotes: string | null;
}): string {
  return event.accessibilityRequired === null ? NOT_SPECIFIED : describeAccessibility(event);
}
