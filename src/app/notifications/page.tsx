import { listNotifications } from '@/domain/notification/service';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { NotificationList } from '@/components/notification/NotificationList';

/**
 * /notifications
 *
 * SCRUM-193 AC1: the signed-in user's own notifications, newest first
 * (listNotifications already orders them). Server component, like
 * /venues/[id] - the list itself needs no interactivity; only marking a row
 * read on click does, so that part is a small client component.
 */
export default async function NotificationsPage() {
  const actor = await getCurrentActor();
  const notifications = await listNotifications(actor.userId);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-semibold">Notifications</h1>
      <NotificationList initialNotifications={notifications} />
    </main>
  );
}
