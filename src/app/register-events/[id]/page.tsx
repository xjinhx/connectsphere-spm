import Link from 'next/link';
import { EventFullNotice } from '@/components/event-registration/EventFullNotice';
import { RegisteredPanel } from '@/components/event-registration/RegisteredPanel';
import { RegistrationForm } from '@/components/event-registration/RegistrationForm';
import { getRegistrationPage } from '@/domain/event-registration/service';
import { formatDayMonthYear } from '@/domain/shared/dates';
import { formatClockRange } from '@/domain/shared/times';
import { getCurrentActor } from '@/lib/auth/currentActor';

export const dynamic = 'force-dynamic';

/**
 * SCRUM-181 — the Attendee's page for one event, where they register.
 *
 * Replaces the SCRUM-72 placeholder. It still shows nothing from the event's
 * internal planning (SCRUM-72 AC1): only what SCRUM-180 AC3 lists below,
 * which is all getRegistrationPage reads.
 *
 * AC1: the form, while the period is open. AC2, AC3: outside it, the start or
 * end date instead of the form. AC5: someone already registered sees their
 * registration instead of the form. SCRUM-182 AC1: a full event is shown as
 * full instead of the form. SCRUM-184 AC1: a registered attendee can withdraw
 * from their registration, after confirming; AC3: not once the event has
 * taken place. Registering shows Withdraw, and withdrawing shows the form
 * again while registration is open, without a reload.
 *
 * SCRUM-180 AC3: opened from Open events, it shows only the event name,
 * description, date, start and end times, venue name and address, and the
 * registration period. Nothing else is read for it (ATTENDEE_EVENT_COLUMNS).
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
      <div className="flex flex-wrap gap-x-4">
        <Link href="/register-events" className="text-sm text-[var(--brand)] underline">
          Back to Open events
        </Link>
        {/* SCRUM-184 AC2: SCRUM-180's My registrations section, where a withdrawn registration is still shown (CL-70). */}
        <Link href="/register-events#my-registrations" className="text-sm text-[var(--brand)] underline">
          My registrations
        </Link>
      </div>
      <h1 className="mt-3 text-2xl font-semibold">{view.eventName}</h1>
      {view.description ? <p className="mt-2 whitespace-pre-line text-sm">{view.description}</p> : null}
      <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        {view.eventDate ? (
          <>
            <dt className="text-[var(--text-muted)]">Event date</dt>
            <dd>{formatDayMonthYear(view.eventDate)}</dd>
          </>
        ) : null}
        {view.times ? (
          <>
            <dt className="text-[var(--text-muted)]">Time</dt>
            <dd>{formatClockRange(view.times)}</dd>
          </>
        ) : null}
        {view.venues.length > 0 ? (
          <>
            <dt className="text-[var(--text-muted)]">{view.venues.length > 1 ? 'Venues' : 'Venue'}</dt>
            <dd>
              <ul>
                {/* Each venue is listed once (bookedVenues), but two venues may share a name. */}
                {view.venues.map((venue, index) => (
                  <li key={`${index}-${venue.name}`}>
                    {venue.name}
                    {venue.address ? (
                      <span className="block text-[var(--text-muted)]">{venue.address}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        ) : null}
        <dt className="text-[var(--text-muted)]">Registration</dt>
        <dd>
          {formatDayMonthYear(view.period.startDate)} to {formatDayMonthYear(view.period.endDate)}
        </dd>
      </dl>

      {view.registration ? (
        <RegisteredPanel
          registration={view.registration}
          eventName={view.eventName}
          canWithdraw={view.canWithdraw}
          canRegisterAgain={canRegister && view.periodRefusal === null}
        />
      ) : view.periodRefusal ? (
        <p role="status" className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
          {view.periodRefusal}
        </p>
      ) : view.full ? (
        <EventFullNotice />
      ) : canRegister ? (
        <RegistrationForm eventRequestId={view.eventRequestId} eventName={view.eventName} canWithdraw={view.canWithdraw} />
      ) : (
        <p className="mt-6 text-sm text-[var(--text-muted)]">Only attendees can register for events.</p>
      )}
    </main>
  );
}
