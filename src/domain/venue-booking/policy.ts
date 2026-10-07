import type { EventRequestStatus } from '@/domain/event-request/schema';
import { isActionPermitted } from '@/domain/identity/permissions';
import type { Role } from '@/domain/identity/roles';
import { formatSingaporeDate } from '@/domain/shared/dates';
import type { VenueBookingRequestLineStatus, VenueBookingRequestStatus } from './schema';

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
