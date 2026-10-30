import Link from 'next/link';
import { MyRegistrationsList } from '@/components/event-registration/MyRegistrationsList';
import { listMyRegistrations } from '@/domain/event-registration/service';
import { getCurrentActor } from '@/lib/auth/currentActor';

export const dynamic = 'force-dynamic';

/**
 * SCRUM-184 AC2 — the Attendee's own registrations, Withdrawn ones shown as
 * Withdrawn rather than removed. Only the signed-in account's.
 *
 * Linked from the event page. Not in the header: SCRUM-255 AC2 gives the
 * Attendee nav one item, Open events.
 */
export default async function MyRegistrationsPage() {
  const actor = await getCurrentActor();
  const registrations = await listMyRegistrations(actor.userId);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col p-8">
      <Link href="/register-events" className="self-start text-sm text-[var(--brand)] underline">
        Back to Open events
      </Link>
      <h1 className="mt-3 text-2xl font-semibold">My registrations</h1>
      <MyRegistrationsList registrations={registrations} />
    </main>
  );
}
