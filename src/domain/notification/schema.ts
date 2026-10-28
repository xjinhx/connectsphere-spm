import { z } from 'zod';

/**
 * Notifications (EP-20): SCRUM-193 View my notifications, SCRUM-198 Notify
 * organisers about review outcomes.
 *
 * Values mirror the check constraint in
 * supabase/migrations/20260929090000_create_notifications.sql.
 */

// -----------------------------------------------------------------------------
// Fixed value lists
// -----------------------------------------------------------------------------

/** SCRUM-198 AC1-3, AC5. AC4 is out of scope for this story - moved to
 * SCRUM-102, which owns the event confirmation path and its notification
 * type (xjinhx, PR #75 review discussion with the PO).
 */
export const NOTIFICATION_TYPES = [
  'clarification_requested',
  'request_approved',
  'request_rejected',
  'coordinator_assigned',
  // SCRUM-198 AC5: the organiser is also told who their coordinator is,
  // distinct from 'coordinator_assigned' (which tells the coordinator
  // themself). Added after PO clarification - see PR discussion.
  'coordinator_named',
  // SCRUM-148/149/151: a decision on a coordinator's venue booking request, or
  // a confirmed booking affected by withdrawn availability.
  'venue_booking_update',
  // SCRUM-197 AC1: an Event Coordinator Lead (operations_manager), told a
  // newly submitted request needs a coordinator assigned.
  'request_submitted',
  // SCRUM-197 AC3: the previous coordinator, told an event was reassigned
  // away from them. The new coordinator reuses 'coordinator_assigned'
  // (same meaning as SCRUM-94: "you now have this event").
  'coordinator_unassigned',
  // SCRUM-102 AC6 (moved from SCRUM-198 AC4, CL-09): the organiser, told their
  // event is confirmed.
  'event_confirmed',
  // SCRUM-166 AC4: the event's assigned coordinator, told Technical Support
  // cannot fulfil its equipment request, with the reason.
  'equipment_unable_to_fulfil',
  // SCRUM-187 AC1: the assigned coordinator, told the organiser raised a
  // change request on their event.
  'change_requested',
] as const;
export const NotificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

export const NotificationIdSchema = z.string().uuid('Notification id must be a valid id.');

// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------

/** SCRUM-193 AC1: newest first is the only order; no query params to sort otherwise yet. */
export const ListNotificationsQuerySchema = z.object({
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});
export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuerySchema>;

// -----------------------------------------------------------------------------
// Outputs
// -----------------------------------------------------------------------------

/** SCRUM-193 AC1: one row in the list. */
export const NotificationSchema = z.object({
  id: z.string().uuid(),
  type: NotificationTypeSchema,
  eventRequestId: z.string().uuid(),
  message: z.string(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof NotificationSchema>;

/** SCRUM-193 AC2: the badge count. */
export const UnreadCountSchema = z.object({
  count: z.number().int().nonnegative(),
});
export type UnreadCount = z.infer<typeof UnreadCountSchema>;
