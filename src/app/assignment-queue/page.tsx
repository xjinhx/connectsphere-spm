import { getCurrentActor } from '@/lib/auth/currentActor';
import { assertPermission } from '@/domain/identity/policy';
import { ForbiddenError } from '@/domain/shared/errors';
import { listUnassignedEvents } from '@/domain/assignment/service';
import { formatSingaporeDate, formatSingaporeDateTime } from '@/domain/shared/dates';

/**
 * SCRUM-95 AC1 — submitted events with no coordinator yet: the pool an
 * Operations Manager works through to keep planning moving.
 *
 * Read-only for now. Assigning a coordinator from this page (SCRUM-94's
 * action, wired to the real POST /coordinator endpoint) is a follow-up -
 * no assign UI exists anywhere yet, so this ticket's scope is the list
 * itself, the same way SCRUM88 left "open full detail" to SCRUM-89.
 */

export const dynamic = 'force-dynamic';

export default async function EventOpsManagerAssignmentQueuePage() {
  const actor = await getCurrentActor();

  try {
    assertPermission(actor.roles, 'coordinator_assignment');
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return (
        <main className="mx-auto max-w-2xl p-8">
          <h1 className="text-2xl font-semibold">Assignment queue</h1>
          <p className="mt-4 text-[var(--text-muted)]">
            This page is for Event Operations Managers. Your account does not currently hold that role.
          </p>
        </main>
      );
    }
    throw error;
  }

  const events = await listUnassignedEvents();

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Assignment queue</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {events.length === 0
            ? 'No submitted events are waiting for a coordinator.'
            : `${events.length} submitted ${events.length === 1 ? 'event needs' : 'events need'} a coordinator.`}
        </p>
      </div>

      {events.length === 0 ? (
        <p className="rounded border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--text-muted)]">
          Nothing in the queue right now.
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
                  Submitted
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
                    {event.submittedAt ? formatSingaporeDateTime(event.submittedAt) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
