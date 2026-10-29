import Link from 'next/link';
import { EventFullNotice } from '@/components/event-registration/EventFullNotice';
import { RegistrationConfirmation } from '@/components/event-registration/RegistrationConfirmation';
import { RegistrationForm } from '@/components/event-registration/RegistrationForm';
import { FINAL_EVENT_REFUSALS } from '@/domain/event-registration/policy';
import { FINAL_EVENT_STATUS_LABELS } from '@/domain/event-registration/schema';
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
 *
 * SCRUM-270: a Cancelled or Completed event says so beside its name and shows
 * why it takes no registrations instead of the form, before any other state
 * (PO, 28/10/2026). Someone already registered still sees their registration
 * below it.
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
      <h1 className="mt-3 text-2xl font-semibold">
        {view.eventName}
        {view.finalStatus ? (
          <span className="ml-2 inline-block rounded-full bg-red-50 px-2 py-0.5 align-middle text-xs font-medium text-red-700">
            {FINAL_EVENT_STATUS_LABELS[view.finalStatus]}
          </span>
        ) : null}
      </h1>
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

      {view.finalStatus ? (
        <>
          <p role="status" className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
            {FINAL_EVENT_REFUSALS[view.finalStatus]}
          </p>
          {view.registration ? (
            <RegistrationConfirmation
              registration={view.registration}
              eventName={view.eventName}
              heading="Your registration for this event."
            />
          ) : null}
        </>
      ) : view.registration ? (
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
