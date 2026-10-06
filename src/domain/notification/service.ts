import {
  fetchNotifications,
  fetchNotificationById,
  fetchUnreadCount,
  markNotificationRead,
  insertNotification,
} from '@/lib/supabase/notifications';
import { NotFoundError, ValidationError } from '@/domain/shared/errors';
import { canAccessNotification } from './policy';
import {
  NotificationIdSchema,
  NotificationSchema,
  NotificationTypeSchema,
  UnreadCountSchema,
  type Notification,
  type NotificationType,
  type UnreadCount,
} from './schema';

/**
 * SCRUM-193 View my notifications, SCRUM-198 Notify organisers about review
 * outcomes.
 *
 * Orchestration only: validates input, applies policy.ts's ownership rule,
 * and calls src/lib/supabase/notifications.ts. Per docs/architecture.md it
 * never imports a Supabase client or builds a query itself.
 */

function toNotification(row: {
  id: string;
  type: string;
  event_request_id: string;
  message: string;
  read_at: string | null;
  created_at: string;
}): Notification {
  return NotificationSchema.parse({
    id: row.id,
    type: row.type,
    eventRequestId: row.event_request_id,
    message: row.message,
    readAt: row.read_at,
    createdAt: row.created_at,
  });
}

/** SCRUM-193 AC1: the signed-in user's own notifications, newest first. */
export async function listNotifications(actorId: string): Promise<Notification[]> {
  const { data, error } = await fetchNotifications(actorId);
  if (error) {
    throw new ValidationError('Could not load notifications.', error.message);
  }
  return (data ?? []).map(toNotification);
}

/** SCRUM-193 AC2: the count for the navigation badge. */
export async function getUnreadCount(actorId: string): Promise<UnreadCount> {
  const { count, error } = await fetchUnreadCount(actorId);
  if (error) {
    throw new ValidationError('Could not load the unread count.', error.message);
  }
  return UnreadCountSchema.parse({ count: count ?? 0 });
}

/**
 * SCRUM-193 AC3: open a notification, marking it read. Idempotent - opening
 * an already-read one returns it unchanged rather than erroring, since
 * re-reading your own notification is not a mistake.
 */
async function getOwnNotificationOrThrow(notificationId: string, actorId: string): Promise<Notification> {
  const { data, error } = await fetchNotifications(actorId);
  if (error || !data) {
    throw new ValidationError('Could not load the notification.', error?.message);
  }
  const found = data.find((row) => row.id === notificationId);
  if (!found) throw new NotFoundError('Notification');
  return toNotification(found);
}

export async function markAsRead(notificationId: string, actorId: string): Promise<Notification> {
  const parsedId = NotificationIdSchema.safeParse(notificationId);
  if (!parsedId.success) throw new NotFoundError('Notification');

  const { data: existing, error: readError } = await fetchNotificationById(parsedId.data);
  if (readError) {
    throw new ValidationError('Could not load the notification.', readError.message);
  }
  if (!existing) throw new NotFoundError('Notification');

  if (!canAccessNotification(existing.recipient_id, actorId)) {
    // Same reasoning as every other "not yours" read in this codebase
    // (SCRUM-89 AC4, canViewRejection): say not found, not forbidden, so a
    // stranger learns nothing about whether the id exists.
    throw new NotFoundError('Notification');
  }

  // TC-193-09: already read - return the current row unchanged rather than
  // re-stamping read_at or treating a second open as an error.
  if (existing.read_at !== null) {
    return getOwnNotificationOrThrow(parsedId.data, actorId);
  }

  const { data: updated, error: updateError } = await markNotificationRead(parsedId.data);
  if (updateError) {
    throw new ValidationError('Could not mark the notification as read.', updateError.message);
  }
  if (!updated) {
    // Raced: read between the check above and the update (e.g. two tabs
    // opening the same notification at once). Re-read once to return the
    // current row rather than error on a harmless race.
    return getOwnNotificationOrThrow(parsedId.data, actorId);
  }

  return toNotification(updated);
}

/**
 * SCRUM-198. Called from review/service.ts and assignment/service.ts via
 * notifyBestEffort. Gives DUMMY(SCRUM-24) D-03, D-05, D-06 and D-08 a real
 * table to write to; only D-03 is actually wired and Replaced by this PR
 * (SCRUM-193/198) - D-05, D-06 and D-08 remain Active until their own
 * stories call this. See docs/dummies.md.
 */
/**
 * Best-effort notification. The caller's own write (a review decision or
 * an assignment) has already succeeded by the time this runs; a
 * notification failure here must never undo it or surface as an error to
 * the caller, so this catches and swallows rather than throwing.
 *
 * Shared by assignment/service.ts and review/service.ts - previously
 * duplicated in each (xjinhx, PR #75 review).
 */
export async function notifyBestEffort(notification: Parameters<typeof createNotification>[0]): Promise<void> {
  try {
    await createNotification(notification);
  } catch (error) {
    console.error('Could not create notification', notification.type, notification.eventRequestId, error);
  }
}

export async function createNotification(notification: {
  recipientId: string;
  type: NotificationType;
  eventRequestId: string;
  message: string;
}): Promise<void> {
  const parsedType = NotificationTypeSchema.safeParse(notification.type);
  if (!parsedType.success) {
    throw new ValidationError('Unknown notification type.', { type: notification.type });
  }
  const { error } = await insertNotification(notification);
  if (error) {
    throw new ValidationError('Could not create the notification.', error.message);
  }
}
