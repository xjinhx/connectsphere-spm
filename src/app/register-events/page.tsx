import Link from 'next/link';
import { listOpenEvents } from '@/domain/event-registration/service';
import { formatDayMonthYear } from '@/domain/shared/dates';
import { formatClockRange } from '@/domain/shared/times';

// "Today" decides what is open, so there is nothing to prerender at build time.
export const dynamic = 'force-dynamic';

/**
 * Open events, the Attendee's landing page (SCRUM-255).
 *
 * SCRUM-180 AC1: every event whose registration period includes today, with
 * its name, date, start and end times and venue, each opening its page
 * (/register-events/[id]) where the attendee registers. AC2: an event whose
 * period has not opened, has closed or is not set is not listed.
 */
export default async function AttendeeRegisterEventsPage() {
  const events = await listOpenEvents();

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
                <span className="mt-1 block text-sm text-[var(--text-muted)]">
                  {[
                    event.eventDate ? formatDayMonthYear(event.eventDate) : null,
                    event.times ? formatClockRange(event.times) : null,
                    event.venues.map((venue) => venue.name).join(', ') || null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
