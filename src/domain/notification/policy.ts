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
 *
 * SCRUM-197 adds two more: 'request_submitted' is sent to every Event
 * Coordinator Lead (operations_manager) before any coordinator is assigned,
 * so neither /events/<id> nor /events/<id>/review is open to them yet (both
 * require either the organiser's organisation or the current coordinator) -
 * it routes to their own /assignment-queue/<id> instead, gated on the
 * coordinator_assignment permission alone (see assignment-queue/[id]/page.tsx),
 * which assigning the event from there satisfies directly.
 *
 * 'coordinator_unassigned' is sent to the *previous* coordinator, who loses
 * both routes the moment the reassignment lands (not the current
 * coordinator_id, and - unless they separately hold the Lead role - not
 * covered by coordinator_assignment either). Review feedback on SCRUM-197
 * (Dylan, PR #117): the organiser default still hits Access Denied - the
 * same failure mode SCRUM-241 exists to fix - so it routes to their own
 * /my-events instead (SCRUM-97), which needs no event id and shows every
 * event still actually assigned to them.
 *
 * SCRUM-166 adds 'equipment_unable_to_fulfil', sent to the event's assigned
 * coordinator. It routes to the event's equipment request, where the
 * coordinator sees the status, who set it, when and the reason (SCRUM-166
 * AC2, AC4) - a page open to them (canViewEquipmentRequest), unlike the
 * organiser's /events/<id>.
 */
const COORDINATOR_FACING_TYPES = new Set<string>(['coordinator_assigned', 'venue_booking_update']);
const LEAD_FACING_TYPES = new Set<string>(['request_submitted']);
const OWN_EVENTS_LIST_TYPES = new Set<string>(['coordinator_unassigned']);
const EQUIPMENT_REQUEST_TYPES = new Set<string>(['equipment_unable_to_fulfil']);
// SCRUM-190 AC5: sent to attendees, who cannot open /events/<id>; their own
// page for the event is /register-events/<id> (SCRUM-180 AC3).
const ATTENDEE_FACING_TYPES = new Set<string>(['event_details_changed']);

export function notificationHref(notification: { type: string; eventRequestId: string }): string {
  if (ATTENDEE_FACING_TYPES.has(notification.type)) {
    return `/register-events/${notification.eventRequestId}`;
  }
  if (LEAD_FACING_TYPES.has(notification.type)) {
    return `/assignment-queue/${notification.eventRequestId}`;
  }
  if (EQUIPMENT_REQUEST_TYPES.has(notification.type)) {
    return `/events/${notification.eventRequestId}/equipment`;
  }
  if (OWN_EVENTS_LIST_TYPES.has(notification.type)) {
    return '/my-events';
  }
  return COORDINATOR_FACING_TYPES.has(notification.type)
    ? `/events/${notification.eventRequestId}/review`
    : `/events/${notification.eventRequestId}`;
}
