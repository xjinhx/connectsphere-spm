import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './admin';
import type { Database } from './database.types';

function db(): SupabaseClient<Database> {
  return createAdminClient();
}

const NOTIFICATION_SELECT = 'id, type, event_request_id, message, read_at, created_at';

export async function fetchNotifications(recipientId: string) {
  return db()
    .from('notifications')
    .select(NOTIFICATION_SELECT)
    .eq('recipient_id', recipientId)
    .order('created_at', { ascending: false });
}

export async function fetchUnreadCount(recipientId: string) {
  return db()
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', recipientId)
    .is('read_at', null);
}

export async function fetchNotificationById(notificationId: string) {
  return db().from('notifications').select('id, recipient_id, read_at').eq('id', notificationId).maybeSingle();
}

export async function markNotificationRead(notificationId: string) {
  return db()
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .is('read_at', null)
    .select('id, type, event_request_id, message, read_at, created_at')
    .maybeSingle();
}

export async function insertNotification(notification: {
  recipientId: string;
  type: string;
  eventRequestId: string;
  message: string;
}) {
  return db().from('notifications').insert({
    recipient_id: notification.recipientId,
    type: notification.type,
    event_request_id: notification.eventRequestId,
    message: notification.message,
  });
}
