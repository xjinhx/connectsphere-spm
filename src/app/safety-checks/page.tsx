import Link from 'next/link';
import { canRunSafetyCheck } from '@/domain/safety-check/policy';
import { listEventsAwaitingSafetyCheck } from '@/domain/safety-check/service';
import { describeEventTimes } from '@/domain/event-request/policy';
import { formatSingaporeDate } from '@/domain/shared/dates';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-234 AC1 — the Safety Officer's landing page: the Confirmed events
 * awaiting an operational safety check, each opening its check page (AC2).
 * AC6 — anyone without the role is told the page is not for them.
 *
 * An account that is also a Coordinator lands here (AC1, Change Log CL-27), so
 * the header links to its coordinator pages too: there is no navigation menu
 * yet (uilogicissue U4), and without them it could only reach its assigned
 * events by typing the address. The same buttons /assigned-events uses.
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
  const alsoCoordinator = actor.roles.includes('coordinator');

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Safety checks</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {events.length === 0
              ? 'No Confirmed events are awaiting a safety check.'
              : `${events.length} Confirmed ${events.length === 1 ? 'event is' : 'events are'} awaiting a safety check.`}
          </p>
        </div>
        {alsoCoordinator ? (
          <div className="flex gap-2">
            <Link
              href="/assigned-events"
              className="inline-block w-fit rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium hover:bg-slate-50"
            >
              Assigned events
            </Link>
            <Link
              href="/my-events"
              className="inline-block w-fit rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium hover:bg-slate-50"
            >
              My events
            </Link>
          </div>
        ) : null}
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
