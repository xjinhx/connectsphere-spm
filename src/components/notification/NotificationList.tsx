'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Notification } from '@/domain/notification/schema';
import { notificationHref } from '@/domain/notification/policy';

const TYPE_LABELS: Record<string, string> = {
  clarification_requested: 'Clarification requested',
  request_approved: 'Approved',
  request_rejected: 'Rejected',
  coordinator_assigned: 'Coordinator assigned',
  coordinator_named: 'Coordinator named',
  venue_booking_update: 'Venue booking',
  request_submitted: 'Needs a coordinator',
  coordinator_unassigned: 'Coordinator removed',
  event_confirmed: 'Event confirmed',
  // SCRUM-166 AC4.
  equipment_unable_to_fulfil: 'Equipment unable to fulfil',
};

/**
 * SCRUM-193 AC1: message, related event, time - already in each row.
 * SCRUM-193 AC3: opening a notification marks it read.
 * SCRUM-241: the link target depends on who the notification is for
 * (notificationHref) - a coordinator-facing type can't open the
 * organiser's /events/<id>, see src/domain/notification/policy.ts.
 */
export function NotificationList({ initialNotifications }: { initialNotifications: Notification[] }) {
  const [notifications, setNotifications] = useState(initialNotifications);

  async function openNotification(notification: Notification) {
    if (notification.readAt !== null) return; // already read, nothing to do

    // Optimistic: mark it read locally immediately, so a second click before
    // the request returns can't double-fire.
    setNotifications((current) =>
      current.map((item) =>
        item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item,
      ),
    );

    try {
      await fetch(`/api/notifications/${notification.id}`, { method: 'PATCH' });
      // Tell NotificationBell to refetch its count - marking read here
      // doesn't navigate, so the bell's pathname-based effect never fires
      // on its own.
      window.dispatchEvent(new Event('notifications:changed'));
    } catch {
      // Leave it marked read locally; the next full page load will reconcile
      // with the server if this silently failed.
    }
  }

  if (notifications.length === 0) {
    return <p className="mt-6 text-sm text-[var(--text-muted)]">No notifications yet.</p>;
  }

  return (
    <ul className="mt-6 flex flex-col gap-2">
      {notifications.map((notification) => (
        <li key={notification.id}>
          <Link
            href={notificationHref(notification)}
            onClick={() => openNotification(notification)}
            className={`block w-full rounded-md border px-4 py-3 text-left text-sm transition-colors ${
              notification.readAt === null
                ? 'border-[var(--brand)] bg-[var(--surface)] font-medium'
                : 'border-[var(--border)] text-[var(--text-muted)]'
            }`}
          >
            <span className="block text-xs uppercase tracking-wide text-[var(--text-muted)]">
              {TYPE_LABELS[notification.type] ?? notification.type}
            </span>
            <span className="mt-1 block">{notification.message}</span>
            <span className="mt-1 block text-xs text-[var(--text-muted)]">
              {new Date(notification.createdAt).toLocaleString('en-SG')}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
