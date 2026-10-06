import Link from 'next/link';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { hasRole } from '@/domain/identity/policy';
import { listMyAssignedEvents } from '@/domain/assignment/service';
import { EventRequestStatusBadge } from '@/components/event-request/EventRequestStatusBadge';
import { formatSingaporeDate } from '@/domain/shared/dates';

/**
 * SCRUM-97 — the Event Coordinator's own events list: every event assigned to
 * the signed-in coordinator, at any status, so their whole workload is in one
 * place.
 *
 * AC1 — each event is shown with its status and proposed date, whatever the
 * status: listMyAssignedEvents (SCRUM-94) applies no status filter.
 *
 * AC2 — events assigned to other coordinators are not shown: the coordinator
 * id is the signed-in account (actor.userId), never taken from the URL, and
 * listEventRequestsForCoordinator only returns that coordinator's events.
 *
 * AC3 — an event reassigned away no longer appears: the list is read from each
 * event's current coordinator every time the page opens, and a reassignment
 * (SCRUM-96) replaces that coordinator.
 *
 * AC1's other half, the review queue, is /assigned-events (SCRUM-88).
 *
 * Shown in the order listMyAssignedEvents returns, oldest submission first,
 * the same as the review queue. The card asks for no particular order.
 *
 * "Open" goes to /events/[id]/review, the same page the review queue links to
 * (SCRUM-89). It shows a request at any status after draft.
 */

export const dynamic = 'force-dynamic';

export default async function CoordinatorMyEventsPage() {
  const actor = await getCurrentActor();

  if (!hasRole(actor.roles, 'coordinator')) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl font-semibold">My events</h1>
        <p className="mt-4 text-[var(--text-muted)]">
          This page is for Event Coordinators. Your account does not currently hold that role.
        </p>
      </main>
    );
  }

  const events = await listMyAssignedEvents(actor.userId);

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">My events</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Every event assigned to you, at any status.</p>
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
                <th scope="col" className="p-3 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="p-3 font-medium">{event.name}</td>
                  <td className="p-3 font-mono text-xs text-[var(--text-muted)]">{event.reference}</td>
                  <td className="p-3">
                    {event.proposedDate ? formatSingaporeDate(event.proposedDate) : '—'}
                  </td>
                  <td className="p-3">
                    <EventRequestStatusBadge status={event.status} />
                  </td>
                  <td className="p-3">
                    <Link href={`/events/${event.id}/review`} className="text-[var(--brand)] hover:underline">
                      Open
                    </Link>
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
