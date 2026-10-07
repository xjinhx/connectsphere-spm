import { NextResponse } from 'next/server';
import { listNotifications, getUnreadCount } from '@/domain/notification/service';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * /api/notifications
 *
 * GET SCRUM-193 AC1 (the list, newest first) and AC2 (the unread count for
 * the navigation badge), returned together so the page and the badge load in
 * one round trip. No permission check: any signed-in user may see their own
 * notifications, the only gate is ownership (service.ts).
 */
export async function GET() {
  try {
    const actor = await getCurrentActor();

    const [notifications, unread] = await Promise.all([
      listNotifications(actor.userId),
      getUnreadCount(actor.userId),
    ]);

    return NextResponse.json({ notifications, unreadCount: unread.count });
  } catch (error) {
    return handleApiError(error);
  }
}
