import type { EventRequestStatus } from '@/domain/event-request/schema';
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

const SLOT_NAMES: Record<string, string> = { am: 'AM', pm: 'PM', night: 'Night' };

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
    `${formatSingaporeDate(line.date)} ${line.timeSlots.map((slot) => SLOT_NAMES[slot] ?? slot).join(' + ')}`;
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

// ---------------------------------------------------------------------------
// SCRUM-149 — Reject a booking request with a reason
// ---------------------------------------------------------------------------

/**
 * AC3: who may open a booking request and see its decision. Venue Staff
 * (venue_administration), who decide it, and the event's assigned coordinator,
 * who sees the reason and the deciding staff member. The card names nobody
 * else.
 */
export function canViewBookingRequest(
  actor: { userId: string; roles: readonly Role[] },
  eventCoordinatorId: string | null,
): boolean {
  return (
    isActionPermitted(actor.roles, 'venue_administration') ||
    (eventCoordinatorId !== null && eventCoordinatorId === actor.userId)
  );
}

// ---------------------------------------------------------------------------
// SCRUM-155 — Block approval of a conflicting booking
// ---------------------------------------------------------------------------

/** AC4: the reason a competing request's line is rejected with (also in the database function). */
export const SLOT_COMMITTED_REASON = 'This slot is committed to another event.';

/** AC1 and AC5: one slot of a line being approved that clashes, and with what. */
export type ApprovalConflict =
  | { lineId: string; date: string; slot: string; kind: 'booked'; event: { reference: string; name: string } | null }
  | { lineId: string; date: string; slot: string; kind: 'unavailable'; reason: string };

/**
 * AC1 and AC5: the slots of these lines that clash: a confirmed booking, or a
 * slot recorded as unavailable. Same venue, same date, same slot, the rule
 * SCRUM-154 applies when a coordinator requests a slot. Venue Staff also see
 * which event holds the slot and why it is unavailable.
 */
export function findApprovalConflicts(
  lines: readonly { id: string; date: string; timeSlots: readonly string[] }[],
  bookings: readonly { date: string; slot: string; event: { reference: string; name: string } | null }[],
  unavailable: readonly { date: string; slot: string; reason: string }[],
): ApprovalConflict[] {
  const conflicts: ApprovalConflict[] = [];
  for (const line of lines) {
    for (const slot of line.timeSlots) {
      const booking = bookings.find((b) => b.date === line.date && b.slot === slot);
      if (booking) {
        conflicts.push({ lineId: line.id, date: line.date, slot, kind: 'booked', event: booking.event });
        continue;
      }
      const withdrawn = unavailable.find((u) => u.date === line.date && u.slot === slot);
      if (withdrawn) {
        conflicts.push({ lineId: line.id, date: line.date, slot, kind: 'unavailable', reason: withdrawn.reason });
      }
    }
  }
  return conflicts;
}

/** AC1: "AM on 15 Nov 2026 is already booked for EVT-2026-0101 (Tech Summit)." AC5: "... is unavailable: Aircon repair." */
export function describeApprovalConflict(conflict: ApprovalConflict): string {
  const when = `${SLOT_NAMES[conflict.slot] ?? conflict.slot} on ${formatSingaporeDate(conflict.date)}`;
  if (conflict.kind === 'unavailable') return `${when} is unavailable: ${conflict.reason}.`;
  return conflict.event
    ? `${when} is already booked for ${conflict.event.reference} (${conflict.event.name}).`
    : `${when} is already booked.`;
}

/** AC4: what a competing request's coordinator is told. */
export function slotCommittedMessage(
  venueName: string,
  lines: readonly { date: string; timeSlots: readonly string[] }[],
): string {
  const when = lines
    .map((line) => `${formatSingaporeDate(line.date)} ${line.timeSlots.map((slot) => SLOT_NAMES[slot] ?? slot).join(' + ')}`)
    .join(', ');
  return `Your booking request for ${venueName} was rejected for ${when}: the slot is now committed to another event.`;
}
