import Link from 'next/link';
import { REGISTRATION_STATUS_LABELS, type OpenEvent } from '@/domain/event-registration/schema';
import { listMyRegistrations, listOpenEvents } from '@/domain/event-registration/service';
import { formatDayMonthYear } from '@/domain/shared/dates';
import { formatClockRange } from '@/domain/shared/times';
import { getCurrentActor } from '@/lib/auth/currentActor';

// "Today" decides what is open, so there is nothing to prerender at build time.
export const dynamic = 'force-dynamic';

/** The event's date, start and end times and venues on one line, leaving out any not set yet. */
function eventSummary(event: OpenEvent): string {
  return [
    event.eventDate ? formatDayMonthYear(event.eventDate) : null,
    event.times ? formatClockRange(event.times) : null,
    event.venues.map((venue) => venue.name).join(', ') || null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Open events, the Attendee's landing page (SCRUM-255).
 *
 * SCRUM-180 AC1: every event whose registration period includes today, with
 * its name, date, start and end times and venue, each opening its page
 * (/register-events/[id]) where the attendee registers. AC2: an event whose
 * period has not opened, has closed or is not set is not listed.
 *
 * AC4: My registrations, below, lists the signed-in attendee's own
 * registrations with each event's details and the registration's status. A
 * section here rather than a page of its own, so the Attendee nav stays the
 * one item SCRUM-255 AC2 names. AC5: the date and times are the event's
 * current ones, so a reschedule shows. AC6: a cancelled event's registration
 * stays listed, with the event marked Cancelled.
 */
export default async function AttendeeRegisterEventsPage() {
  const actor = await getCurrentActor();
  const [events, registrations] = await Promise.all([listOpenEvents(), listMyRegistrations(actor.userId)]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col p-8">
      <h1 className="text-2xl font-semibold">Events Open for Registration</h1>

      {events.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--text-muted)]">No events are open for registration right now.</p>
      ) : (
        <ul className="mt-6 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          {events.map((event) => (
            <li key={event.eventRequestId}>
              <Link href={`/register-events/${event.eventRequestId}`} className="block px-4 py-3 hover:bg-slate-50">
                <span className="font-medium text-[var(--brand)] underline">{event.eventName}</span>
                <span className="mt-1 block text-sm text-[var(--text-muted)]">{eventSummary(event)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="my-registrations" className="mt-10">
        <h2 id="my-registrations" className="text-xl font-semibold">
          My registrations
        </h2>
        {registrations.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--text-muted)]">You have not registered for any events yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            {registrations.map((registration) => (
              <li
                key={registration.registrationId}
                className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
              >
                <div>
                  <span className="font-medium">{registration.eventName}</span>
                  {registration.eventCancelled ? (
                    <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                      Cancelled
                    </span>
                  ) : null}
                  <span className="mt-1 block text-sm text-[var(--text-muted)]">{eventSummary(registration)}</span>
                </div>
                <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs font-medium">
                  {REGISTRATION_STATUS_LABELS[registration.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
