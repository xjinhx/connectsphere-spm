'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * SCRUM-193 AC2: the unread count badge in the navigation. Fetches on mount
 * and again on every route change, so approving a request or opening a
 * notification elsewhere in the app is reflected without a poll or a
 * websocket - acceptable staleness for a course-project sprint.
 */
export function NotificationBell() {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadCount() {
      try {
        const response = await fetch('/api/notifications');
        if (!response.ok) return;
        const body = (await response.json()) as { unreadCount?: number };
        if (!cancelled) setUnreadCount(body.unreadCount ?? 0);
      } catch {
        // Silently leave the count as it was; not worth a visible error for a badge.
      }
    }

    loadCount();
    window.addEventListener('notifications:changed', loadCount);
    return () => {
      cancelled = true;
      window.removeEventListener('notifications:changed', loadCount);
    };
  }, [pathname]);

  return (
    <Link
      href="/notifications"
      className="relative rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--surface)]"
    >
      Notifications
      {unreadCount !== null && unreadCount > 0 && (
        <span
          className="ml-2 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-[var(--danger)] px-1.5 py-0.5 text-xs font-semibold text-white"
          aria-label={`${unreadCount} unread notifications`}
        >
          {unreadCount}
        </span>
      )}
    </Link>
  );
}
