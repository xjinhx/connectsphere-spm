import Link from 'next/link';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { RolePagesBar } from '@/components/navigation/RolePagesBar';
import { hasRole } from '@/domain/identity/policy';
import { listMyAssignedEvents } from '@/domain/assignment/service';
import { isAwaitingReview } from '@/domain/review/policy';
import { EventRequestStatusBadge } from '@/components/event-request/EventRequestStatusBadge';
import { formatSingaporeDate, formatSingaporeDateTime } from '@/domain/shared/dates';
import { formatClockRange } from '@/domain/shared/times';

/** SCRUM-238 — the event's times, or a dash until the organiser has given them. */
function formatTimes(event: { startTime: string | null; endTime: string | null }): string {
  if (event.startTime === null || event.endTime === null) return '—';
  return formatClockRange({ start: event.startTime, end: event.endTime });
}

/**
 * SCRUM-88 AC1/AC3 — the Event Coordinator's review queue: the events
 * assigned to the signed-in coordinator that are still awaiting a decision.
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
 * Client organisation (AC1's remaining field) is null until an organiser
 * has been linked to one (SCRUM-204) - shown as "—" rather than treated as
 * an error, since an unlinked organiser is a real, permanent state, not a
 * gap waiting to close (dummy D-01, narrowed to this page once SCRUM-203/
 * 204 landed).
 *
 * "Open the full detail" (AC2, US-7.1-TC02) links to /events/[id]/review —
 * SCRUM-89's page, built there rather than here.
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

  // SCRUM-97 AC1 — "my review queue shows only those awaiting review". This
  // page used to list every assigned event and highlight the awaiting ones;
  // every assigned event, at any status, is now on /my-events instead.
  // Awaiting review means submitted (isAwaitingReview), so Approved, Rejected
  // and Clarification Requested are left out, as SCRUM-88 AC3 says, and so is
  // every later status.
  const assigned = await listMyAssignedEvents(actor.userId);
  const events = assigned.filter((event) => isAwaitingReview(event.status));

  return (
    <main className="mx-auto max-w-4xl p-6">
      {/* SCRUM-234 — for an account that is also a Safety Officer only. */}
      <RolePagesBar roles={actor.roles} current="/assigned-events" />
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Assigned events</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {events.length === 0
              ? 'Nothing awaiting your review right now.'
              : `${events.length} ${events.length === 1 ? 'event needs' : 'events need'} your review.`}
          </p>
        </div>
        <div className="flex gap-2">
          {/* SCRUM-97 — the way into the coordinator's full events list, at
              any status, from their landing page. */}
          <Link
            href="/my-events"
            className="inline-block w-fit rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium hover:bg-slate-50"
          >
            My events
          </Link>
          {/* SCRUM-203 — a way into the client organisations pages from the
              Coordinator landing page. */}
          <Link
            href="/organisations"
            className="inline-block w-fit rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)]"
          >
            Client organisations
          </Link>
        </div>
      </div>

      {events.length === 0 ? (
        <p className="rounded border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--text-muted)]">
          {assigned.length === 0
            ? 'No events have been assigned to you yet.'
            : 'Your other assigned events are on My events.'}
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
                  Client organisation
                </th>
                <th scope="col" className="p-3 font-medium">
                  Proposed date
                </th>
                <th scope="col" className="p-3 font-medium">
                  Time
                </th>
                <th scope="col" className="p-3 font-medium">
                  Submitted
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
                  <td className="p-3">{event.clientOrganisation?.name ?? '—'}</td>
                  <td className="p-3">
                    {event.proposedDate ? formatSingaporeDate(event.proposedDate) : '—'}
                  </td>
                  <td className="p-3">{formatTimes(event)}</td>
                  <td className="p-3">
                    {event.submittedAt ? formatSingaporeDateTime(event.submittedAt) : '—'}
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
        {assigned.length} {assigned.length === 1 ? 'event' : 'events'} assigned to you.
      </p>
    </main>
  );
}
