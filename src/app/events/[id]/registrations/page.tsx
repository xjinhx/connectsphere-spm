import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EventRequestStatusBadge } from '@/components/event-request/EventRequestStatusBadge';
import { RegistrationList } from '@/components/registration-list/RegistrationList';
import { RegistrationSettingsPanel } from '@/components/registration-list/RegistrationSettingsPanel';
import { NO_ACCESS_MESSAGE } from '@/domain/registration-list/policy';
import type { RegistrationListView, RegistrationSettingsView } from '@/domain/registration-list/schema';
import { getRegistrationList, getRegistrationSettings } from '@/domain/registration-list/service';
import { ForbiddenError, NotFoundError } from '@/domain/shared/errors';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-185 — the event's registration page.
 *
 * AC1: the assigned coordinator sees every registration with its date and
 *      status, and the number registered, the capacity and places remaining.
 * AC2: the Event Organiser responsible for the event sees the same and can
 *      export it.
 * AC3: an organiser in the same client organisation sees it, with no Export.
 * AC4: anyone else is denied, and nothing about the registrations is shown.
 * AC5, AC6: below the list, the assigned coordinator sets the registration
 *      start date, end date and capacity once the event is Confirmed. The
 *      Lead sees the values read-only; organisers see the capacity in the
 *      counts only.
 *
 * Force-dynamic, so after a save the values are read back from the stored rows.
 */

export const dynamic = 'force-dynamic';

export default async function EventRegistrationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getCurrentActor();

  let list: RegistrationListView;
  try {
    list = await getRegistrationList(id, actor);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) {
      return (
        <main className="mx-auto max-w-2xl p-8">
          <h1 className="text-2xl font-semibold">Registration list</h1>
          <p className="mt-4 text-[var(--text-muted)]">{NO_ACCESS_MESSAGE}</p>
        </main>
      );
    }
    throw error;
  }

  // AC5: the settings belong to the coordinator's side of the page.
  const staff = list.viewer === 'coordinator' || list.viewer === 'lead';
  const settings: RegistrationSettingsView | null = staff ? await getRegistrationSettings(id, actor) : null;

  // Back to the event page the viewer came from: the coordinator's review page,
  // or the organiser's request page.
  const backHref = staff ? `/events/${id}/review` : `/events/${id}`;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href={backHref} className="text-sm text-[var(--brand)] hover:underline">
        ← {list.eventName}
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Registration: {list.eventName}</h1>
        <EventRequestStatusBadge status={list.eventStatus} />
      </div>
      <p className="mt-1 font-mono text-sm text-[var(--text-muted)]">{list.eventReference}</p>

      <RegistrationList view={list} />

      {settings ? <RegistrationSettingsPanel view={settings} /> : null}
    </main>
  );
}
