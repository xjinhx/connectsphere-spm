import { EVENT_REQUEST_STATUS_LABELS, type EventRequestStatus } from '@/domain/event-request/schema';
import { isCurrentCoordinator } from '@/domain/assignment/policy';

/**
 * SCRUM-110 — Edit ordinary event information. Pure rules; service.ts applies them.
 */

/**
 * AC5: a Completed or Cancelled event is history, read-only for everyone.
 * Restated by updateEventInformationRow's status filter
 * (src/lib/supabase/eventInformation.ts); change one, change the other.
 */
export function isFinishedEvent(status: EventRequestStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}

/**
 * AC1: the event's assigned coordinator, while the event is not Completed or
 * Cancelled. A draft has no coordinator, so it never qualifies here; the
 * organiser edits a draft through SCRUM-85 instead (AC2 applies only once the
 * event has been submitted).
 */
export function canEditEventInformation(
  event: { status: EventRequestStatus; coordinatorId: string | null },
  actorUserId: string,
): boolean {
  return isCurrentCoordinator(event.coordinatorId, actorUserId) && !isFinishedEvent(event.status);
}

/** AC5's wording: why a finished event offers no edit action. */
export function finishedEventNotice(status: EventRequestStatus): string {
  return `This event is ${EVENT_REQUEST_STATUS_LABELS[status]}. Its record is read-only and kept as history.`;
}

/**
 * AC2: what the responsible Event Organiser is told once the event has been
 * submitted. They have no edit action; changes go through the coordinator.
 */
export const REQUEST_CHANGES_THROUGH_COORDINATOR =
  'This request has been submitted and is now read-only. To change it, request changes through your Event Coordinator.';

export const NOT_ASSIGNED_MESSAGE = 'This event is not assigned to you.';
