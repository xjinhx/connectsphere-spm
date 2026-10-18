import Link from 'next/link';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { isActionPermitted } from '@/domain/identity/permissions';
import { getCoordinatorOverview } from '@/domain/assignment/service';
import { EventRequestStatusBadge } from '@/components/event-request/EventRequestStatusBadge';
import { formatSingaporeDate } from '@/domain/shared/dates';

/**
 * SCRUM-233 — one view of every coordinator's assigned events, so the Event
 * Coordinator Lead can balance the work and spot events that need
 * reassigning.
 *
 * AC1 — every coordinator is listed with their active events, each showing
 * status and proposed date. A coordinator with none is still listed, with an
 * empty section, so the Lead can see who has room to take on more.
 * AC2 — Completed, Cancelled and Rejected events are already excluded by
 * getCoordinatorOverview, so nothing here filters again.
 * AC3 — an event groups under whichever coordinator currently holds it, so a
 * reassigned event simply appears under its new coordinator the next time
 * this page is loaded; there is nothing extra to render for that case.
 * AC4 — gated by the same `coordinator_assignment` permission the assignment
 * queue and the assignment record page use; everyone else is told this page
 * is not for their role, the same pattern those pages use.
 */

export const dynamic = 'force-dynamic';

export default async function CoordinatorOverviewPage() {
  const actor = await getCurrentActor();

  if (!isActionPermitted(actor.roles, 'coordinator_assignment')) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl font-semibold">Coordinator overview</h1>
        <p className="mt-4 text-[var(--text-muted)]">
          This page is for the Event Coordinator Lead. Your account does not currently hold that role.
        </p>
      </main>
    );
  }

  const workloads = await getCoordinatorOverview(actor);
  const totalActive = workloads.reduce((sum, w) => sum + w.activeEvents.length, 0);

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Coordinator overview</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {workloads.length === 0
            ? 'No coordinators yet.'
            : `${totalActive} active ${totalActive === 1 ? 'event' : 'events'} across ${workloads.length} ${
                workloads.length === 1 ? 'coordinator' : 'coordinators'
              }.`}
        </p>
      </div>

      {workloads.length === 0 ? (
        <p className="rounded border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--text-muted)]">
          No accounts hold the Event Coordinator role yet.
        </p>
      ) : (
        <div className="space-y-6">
          {workloads.map((workload) => (
            <section
              key={workload.coordinatorId}
              className="rounded border border-[var(--border)] bg-[var(--surface)]"
            >
              <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                <h2 className="font-semibold">
                  {workload.coordinatorName ?? workload.coordinatorEmail ?? 'Name not recorded'}
                </h2>
                <span className="text-sm text-[var(--text-muted)]">
                  {workload.activeEvents.length} active{' '}
                  {workload.activeEvents.length === 1 ? 'event' : 'events'}
                </span>
              </div>

              {workload.activeEvents.length === 0 ? (
                <p className="px-4 py-3 text-sm text-[var(--text-muted)]">No active events.</p>
              ) : (
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
                        Status
                      </th>
                      <th scope="col" className="p-3 font-medium">
                        Proposed date
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {workload.activeEvents.map((event) => (
                      <tr key={event.id} className="border-b border-[var(--border)] last:border-b-0">
                        <td className="p-3 font-medium">
                          <Link href={`/events/${event.id}/review`} className="text-[var(--brand)] hover:underline">
                            {event.name}
                          </Link>
                        </td>
                        <td className="p-3 font-mono text-xs text-[var(--text-muted)]">{event.reference}</td>
                        <td className="p-3">
                          <EventRequestStatusBadge status={event.status} />
                        </td>
                        <td className="p-3">
                          {event.proposedDate ? formatSingaporeDate(event.proposedDate) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
