import { isCurrentCoordinator } from '@/domain/assignment/policy';
import { EVENT_REQUEST_STATUS_LABELS, type EventRequestStatus } from '@/domain/event-request/schema';

/**
 * SCRUM-185 — View the registration list for an event. Pure rules only;
 * service.ts applies them.
 */

/**
 * AC5: the registration period and capacity are set on a Confirmed event.
 * Restated by updateRegistrationSettingsRow's status filter
 * (src/lib/supabase/registrationList.ts); change one, change the other.
 */
export function acceptsRegistrationSettings(status: EventRequestStatus): boolean {
  return status === 'confirmed';
}

/** AC5: the event's assigned coordinator, while the event is Confirmed. */
export function canEditRegistrationSettings(
  event: { status: EventRequestStatus; coordinatorId: string | null },
  actorUserId: string,
): boolean {
  return isCurrentCoordinator(event.coordinatorId, actorUserId) && acceptsRegistrationSettings(event.status);
}

export function notConfirmedNotice(status: EventRequestStatus): string {
  return `This event is ${EVENT_REQUEST_STATUS_LABELS[status]}. Registration is set once the event is Confirmed.`;
}

/**
 * AC6: the most the capacity may be. For an event with several venues, the
 * largest of their capacities, not the smallest (Sprint 4 Planning, CL-59):
 * SCRUM-230 gives each booking its own attendance. Null when the event has no
 * confirmed venue.
 */
export function largestVenueCapacity(capacities: readonly number[]): number | null {
  return capacities.length === 0 ? null : Math.max(...capacities);
}

/** AC6: the message naming the capacity field and the limit it went over. */
export function capacityOverVenueMessage(limit: number): string {
  return `Capacity must be no more than ${limit}, the largest capacity of this event's venues.`;
}

/** AC6 cannot be checked without a venue, so the capacity is not accepted. */
export const NO_CONFIRMED_VENUE_MESSAGE =
  'This event has no confirmed venue booking, so its capacity cannot be checked against a venue.';

export const NOT_ASSIGNED_MESSAGE = 'This event is not assigned to you.';
