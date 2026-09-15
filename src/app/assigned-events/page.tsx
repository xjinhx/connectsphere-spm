import { getCurrentActor } from '@/lib/auth/currentActor';
import { hasRole } from '@/domain/identity/policy';
import { listMyAssignedEvents } from '@/domain/assignment/service';
import { isAwaitingReview } from '@/domain/review/policy';
import { EventRequestStatusBadge } from '@/components/event-request/EventRequestStatusBadge';
import { formatSingaporeDate } from '@/domain/shared/dates';

/**
 * SCRUM-88 AC1/AC3 — the Event Coordinator's review queue: every event
 * assigned to the signed-in coordinator, with the ones still awaiting a
 * decision made clear.
 *
 * The actual data comes from SCRUM-94's listMyAssignedEvents(), via
 * domain/assignment/service.ts - this page is the queue itself, per the
 * comment in /api/assigned-events/route.ts.
 *
 * AC1's "assigned to me" filter is already applied by
 * listEventRequestsForCoordinator, which only ever returns the calling
 * coordinator's own events - so nothing here needs to filter by coordinator
 * id again.
 *
 * "Open the full detail" (AC2) is SCRUM-89's story, not built here.
 */

export const dynamic = 'force-dynamic';

export default async function EventCoordinatorAssignedEventsPage() {
  const actor = await getCurrentActor();

  if (!hasRole(actor.roles, 'coordinator')) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl font-semibold">Assigned events</h1>
        <p className="mt-4 text-[var(--text-muted)]">
          This page is for Event Coordinators. Your account does not currently hold that role.
        </p>
      </main>
    );
  }

  const events = await listMyAssignedEvents(actor.userId);
  const awaitingCount = events.filter((event) => isAwaitingReview(event.status)).length;

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Assigned events</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {awaitingCount === 0
            ? 'Nothing awaiting your review right now.'
            : `${awaitingCount} ${awaitingCount === 1 ? 'event needs' : 'events need'} your review.`}
        </p>
      </div>

      {events.length === 0 ? (
        <p className="rounded border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--text-muted)]">
          No events have been assigned to you yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                <th scope="col" className="p-3 font-medium">
                  Name
                </th>
                <th scope="col" className="p-3 font-medium">
                  Reference
                </th>
                <th scope="col" className="p-3 font-medium">
                  Proposed date
                </th>
                <th scope="col" className="p-3 font-medium">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr
                  key={event.id}
                  className={`border-b border-[var(--border)] last:border-b-0 ${
                    isAwaitingReview(event.status) ? 'bg-blue-50/40' : ''
                  }`}
                >
                  <td className="p-3 font-medium">{event.name}</td>
                  <td className="p-3 font-mono text-xs text-[var(--text-muted)]">{event.reference}</td>
                  <td className="p-3">
                    {event.proposedDate ? formatSingaporeDate(event.proposedDate) : '—'}
                  </td>
                  <td className="p-3">
                    <EventRequestStatusBadge status={event.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-sm text-[var(--text-muted)]">
        {events.length} {events.length === 1 ? 'event' : 'events'} assigned to you.
      </p>
    </main>
  );
}