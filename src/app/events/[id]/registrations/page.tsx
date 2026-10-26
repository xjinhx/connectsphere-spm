import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RegistrationSettingsPanel } from '@/components/registration-list/RegistrationSettingsPanel';
import type { RegistrationSettingsView } from '@/domain/registration-list/schema';
import { getRegistrationSettings } from '@/domain/registration-list/service';
import { ForbiddenError, NotFoundError } from '@/domain/shared/errors';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-185 — the event's registration page.
 *
 * AC5, AC6: the registration start date, end date and capacity, which the
 * assigned coordinator sets here once the event is Confirmed.
 *
 * The registered attendees and places remaining (AC1) and the organiser's view
 * and export (AC2-AC4) join this page next.
 *
 * Force-dynamic, so after a save the values are read back from the stored row.
 */

export const dynamic = 'force-dynamic';

export default async function EventRegistrationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getCurrentActor();

  let settings: RegistrationSettingsView;
  try {
    settings = await getRegistrationSettings(id, actor);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) {
      return (
        <main className="mx-auto max-w-2xl p-8">
          <h1 className="text-2xl font-semibold">Registration</h1>
          <p className="mt-4 text-[var(--text-muted)]">
            Only the event&apos;s assigned coordinator can view its registration.
          </p>
        </main>
      );
    }
    throw error;
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href={`/events/${id}/review`} className="text-sm text-[var(--brand)] hover:underline">
        ← {settings.eventName}
      </Link>

      <h1 className="mt-4 text-xl font-semibold">Registration: {settings.eventName}</h1>
      <p className="mt-1 font-mono text-sm text-[var(--text-muted)]">{settings.eventReference}</p>

      <RegistrationSettingsPanel view={settings} />
    </main>
  );
}
