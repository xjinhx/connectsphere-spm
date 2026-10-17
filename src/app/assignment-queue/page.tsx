import Link from 'next/link';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { assertPermission } from '@/domain/identity/policy';
import { ForbiddenError } from '@/domain/shared/errors';
import { listAssignableCoordinators, listUnassignedEvents } from '@/domain/assignment/service';
import { AssignCoordinatorForm } from '@/components/assignment/AssignCoordinatorForm';
import { formatSingaporeDate, formatSingaporeDateTime } from '@/domain/shared/dates';
import { describeEventTimes } from '@/domain/event-request/policy';

/**
 * SCRUM-95 AC1 — submitted events with no coordinator yet: the pool an
 * Operations Manager works through to keep planning moving.
 *
 * The list itself is this ticket. The Assign action in the last column is
 * SCRUM-94's, added here afterwards as this comment anticipated: it posts to
 * SCRUM-94's own POST /coordinator endpoint and nothing about the list above
 * it changed. See AssignCoordinatorForm.
 *
 * SCRUM-232 AC2 — the Lead's unassigned queue shows each request's event name,
 * client organisation, proposed date and time, expected attendance and
 * submission date. "Slots" on the card are shown as times since SCRUM-238.
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

  // Read together: one list of coordinators serves every row, rather than each
  // row fetching the same names.
  const [events, coordinators] = await Promise.all([
    listUnassignedEvents(),
    listAssignableCoordinators(),
  ]);

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
                  Client organisation
                </th>
                <th scope="col" className="p-3 font-medium">
                  Proposed date
                </th>
                <th scope="col" className="p-3 font-medium">
                  Time
                </th>
                <th scope="col" className="p-3 font-medium">
                  Expected attendance
                </th>
                <th scope="col" className="p-3 font-medium">
                  Submitted
                </th>
                {/* SCRUM-94 AC1 — the assign action. */}
                <th scope="col" className="p-3 font-medium">
                  Coordinator
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="p-3 font-medium">
                    {/* SCRUM-232 AC3 — the event's assignment page, where the
                        record is shown and the event can be reassigned later. */}
                    <Link href={`/assignment-queue/${event.id}`} className="text-[var(--brand)] hover:underline">
                      {event.name}
                    </Link>
                  </td>
                  <td className="p-3 font-mono text-xs text-[var(--text-muted)]">{event.reference}</td>
                  <td className="p-3">{event.clientOrganisation?.name ?? '—'}</td>
                  <td className="p-3">
                    {event.proposedDate ? formatSingaporeDate(event.proposedDate) : '—'}
                  </td>
                  <td className="p-3">{describeEventTimes(event.startTime, event.endTime)}</td>
                  <td className="p-3">{event.expectedAttendance ?? '—'}</td>
                  <td className="p-3">
                    {event.submittedAt ? formatSingaporeDateTime(event.submittedAt) : '—'}
                  </td>
                  <td className="p-3">
                    <AssignCoordinatorForm
                      eventRequestId={event.id}
                      coordinators={coordinators}
                    />
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
