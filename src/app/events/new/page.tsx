import { EventRequestForm } from '@/components/event-request/EventRequestForm';
import { getNewEventRequestContext } from '@/domain/event-request/service';
import { todayInSingapore } from '@/domain/shared/dates';

// Depends on who is signed in, so there is nothing to prerender at build time.
export const dynamic = 'force-dynamic';

export default async function NewEventRequestPage() {
  const { clientOrganisation } = await getNewEventRequestContext();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-semibold">New event request</h1>
      <p className="mt-1 mb-6 text-sm text-[var(--text-muted)]">
        Capture the basics now. You can save a draft and finish it later.
      </p>

      <EventRequestForm clientOrganisation={clientOrganisation} today={todayInSingapore()} />
    </main>
  );
}
