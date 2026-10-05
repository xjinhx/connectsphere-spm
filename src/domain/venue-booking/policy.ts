import type { EventRequestStatus } from '@/domain/event-request/schema';

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
// SCRUM-147 — View the pending booking request queue
// ---------------------------------------------------------------------------

export const BOOKING_QUEUE_SORTS = ['requested'] as const;
export type BookingQueueSort = (typeof BOOKING_QUEUE_SORTS)[number];

/**
 * The order the queue is shown in. 'requested': the oldest request first, so
 * Venue Staff work through requests in the order they arrived.
 *
 * Returns a new array; the input is not reordered in place.
 */
export function sortBookingQueue<T extends { lineId: string; date: string; requestedAt: string }>(
  entries: readonly T[],
  sort: BookingQueueSort,
): T[] {
  const byRequested = (a: T, b: T) =>
    Date.parse(a.requestedAt) - Date.parse(b.requestedAt) || a.lineId.localeCompare(b.lineId);
  const order: Record<BookingQueueSort, (a: T, b: T) => number> = { requested: byRequested };
  return [...entries].sort(order[sort]);
}
