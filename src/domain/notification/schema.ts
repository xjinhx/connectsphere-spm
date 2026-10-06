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

/**
 * SCRUM-198 AC1-3, AC5, plus AC4's type.
 *
 * DUMMY(SCRUM-10) D-09: 'event_confirmed' has no call site. AC4 needs an
 * event 'Confirmed' status this sprint's Event Status Management
 * (SCRUM-101) does not create (it stops at Planning, by agreement with the
 * product owner - see docs/dummies.md D-09). Wire the call site once a
 * story introduces that status.
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
  'event_confirmed',
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
