import Link from 'next/link';
import { canRunSafetyCheck } from '@/domain/safety-check/policy';
import { listEventsAwaitingSafetyCheck } from '@/domain/safety-check/service';
import { describeEventTimes } from '@/domain/event-request/policy';
import { formatSingaporeDate } from '@/domain/shared/dates';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-234 AC1 — the Safety Officer's landing page: the Confirmed events
 * awaiting an operational safety check, each opening its check page (AC2).
 * AC7 — anyone without the role is told the page is not for them.
 */

export const dynamic = 'force-dynamic';

export default async function SafetyCheckListPage() {
  const actor = await getCurrentActor();
  if (!canRunSafetyCheck(actor.roles)) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl font-semibold">Safety checks</h1>
        <p className="mt-4 text-[var(--text-muted)]">
          This page is for Safety Officers. Your account does not currently hold that role.
        </p>
      </main>
    );
  }

  const events = await listEventsAwaitingSafetyCheck(actor);

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Safety checks</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {events.length === 0
            ? 'No Confirmed events are awaiting a safety check.'
            : `${events.length} Confirmed ${events.length === 1 ? 'event is' : 'events are'} awaiting a safety check.`}
        </p>
      </div>

      {events.length === 0 ? (
        <p className="rounded border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--text-muted)]">
          Nothing to check right now.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                <th scope="col" className="p-3 font-medium">Name</th>
                <th scope="col" className="p-3 font-medium">Reference</th>
                <th scope="col" className="p-3 font-medium">Client organisation</th>
                <th scope="col" className="p-3 font-medium">Date</th>
                <th scope="col" className="p-3 font-medium">Time</th>
                <th scope="col" className="p-3 font-medium">Venue</th>
                <th scope="col" className="p-3 font-medium">Expected attendance</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="p-3 font-medium">
                    <Link href={`/safety-checks/${event.id}`} className="text-[var(--brand)] hover:underline">
                      {event.name}
                    </Link>
                  </td>
                  <td className="p-3 font-mono text-xs text-[var(--text-muted)]">{event.reference}</td>
                  <td className="p-3">{event.clientOrganisation ?? '—'}</td>
                  <td className="p-3">{event.proposedDate ? formatSingaporeDate(event.proposedDate) : '—'}</td>
                  <td className="p-3">{describeEventTimes(event.startTime, event.endTime)}</td>
                  <td className="p-3">{event.venues.length > 0 ? event.venues.join(', ') : '—'}</td>
                  <td className="p-3">{event.expectedAttendance ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
