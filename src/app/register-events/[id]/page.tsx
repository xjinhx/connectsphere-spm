import Link from 'next/link';
import { EventFullNotice } from '@/components/event-registration/EventFullNotice';
import { RegistrationConfirmation } from '@/components/event-registration/RegistrationConfirmation';
import { RegistrationForm } from '@/components/event-registration/RegistrationForm';
import { getRegistrationPage } from '@/domain/event-registration/service';
import { formatDayMonthYear } from '@/domain/shared/dates';
import { getCurrentActor } from '@/lib/auth/currentActor';

export const dynamic = 'force-dynamic';

/**
 * SCRUM-181 — the Attendee's page for one event, where they register.
 *
 * Replaces the SCRUM-72 placeholder. It still shows nothing from the event's
 * internal planning (SCRUM-72 AC1): only the name, the date and the
 * registration period, which is all getRegistrationPage reads.
 *
 * AC1: the form, while the period is open. AC2, AC3: outside it, the start or
 * end date instead of the form. AC5: someone already registered sees their
 * registration instead of the form. SCRUM-182 AC1: a full event is shown as
 * full instead of the form.
 *
 * Reached by its address for now: listing the events open for registration is
 * another story's.
 *
 * SCRUM-255 AC3: a back link to Open events, above everything that changes
 * with the registration state, so every state shows it. A plain link, not
 * history back, so it leads to Open events whatever page came before.
 */
export default async function AttendeeEventRegistrationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getCurrentActor();
  const view = await getRegistrationPage(id, actor.userId);
  const canRegister = actor.roles.includes('attendee');

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col p-8">
      <Link href="/register-events" className="self-start text-sm text-[var(--brand)] underline">
        Back to Open events
      </Link>
      <h1 className="mt-3 text-2xl font-semibold">{view.eventName}</h1>
      <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        {view.eventDate ? (
          <>
            <dt className="text-[var(--text-muted)]">Event date</dt>
            <dd>{formatDayMonthYear(view.eventDate)}</dd>
          </>
        ) : null}
        <dt className="text-[var(--text-muted)]">Registration</dt>
        <dd>
          {formatDayMonthYear(view.period.startDate)} to {formatDayMonthYear(view.period.endDate)}
        </dd>
      </dl>

      {view.registration ? (
        <RegistrationConfirmation
          registration={view.registration}
          eventName={view.eventName}
          heading="You are registered for this event."
        />
      ) : view.periodRefusal ? (
        <p role="status" className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
          {view.periodRefusal}
        </p>
      ) : view.full ? (
        <EventFullNotice />
      ) : canRegister ? (
        <RegistrationForm eventRequestId={view.eventRequestId} eventName={view.eventName} />
      ) : (
        <p className="mt-6 text-sm text-[var(--text-muted)]">Only attendees can register for events.</p>
      )}
    </main>
  );
}
