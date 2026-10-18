/**
 * Notifications: who may read or act on which row.
 *
 * SCRUM-193's implicit access rule: a notification was generated for one
 * person, and only that person may see or mark it read. No role check - any
 * account type can be a recipient (an Organiser gets review outcomes, a
 * Coordinator gets assignment/clarification notices per the DUMMY(SCRUM-24)
 * markers this story replaces). This is the same "connected to the thing"
 * pattern identity/policy.ts's comment describes for other narrowed reads,
 * just narrower still: connected means "is the recipient", not "shares a
 * role with it".
 */
export function canAccessNotification(recipientId: string, actorId: string): boolean {
  return recipientId === actorId;
}

/**
 * SCRUM-241 (bug found in SCRUM-193): which page a notification's recipient
 * can actually open for its event.
 *
 * 'coordinator_assigned' and 'venue_booking_update' are sent to the event's
 * coordinator (src/domain/assignment/service.ts, src/domain/venue-booking/
 * service.ts, src/domain/availability/service.ts) - the coordinator can't
 * open the organiser's /events/<id> (getEventRequest throws ForbiddenError
 * for anyone who isn't the owning organiser or a colleague in the same
 * client organisation), so these route to the coordinator's review page
 * instead. The remaining types ('request_approved', 'request_rejected',
 * 'coordinator_named', 'clarification_requested') are sent to the organiser
 * (src/domain/review/service.ts, src/domain/assignment/service.ts), whose
 * own /events/<id> is correct. Any future type defaults to the organiser's
 * page, matching the behaviour before this fix.
 */
const COORDINATOR_FACING_TYPES = new Set<string>(['coordinator_assigned', 'venue_booking_update']);

export function notificationHref(notification: { type: string; eventRequestId: string }): string {
  return COORDINATOR_FACING_TYPES.has(notification.type)
    ? `/events/${notification.eventRequestId}/review`
    : `/events/${notification.eventRequestId}`;
}
