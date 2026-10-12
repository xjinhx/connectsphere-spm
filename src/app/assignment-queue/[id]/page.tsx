import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AssignCoordinatorForm } from '@/components/assignment/AssignCoordinatorForm';
import { ReassignCoordinatorForm } from '@/components/assignment/ReassignCoordinatorForm';
import { EventRequestStatusBadge } from '@/components/event-request/EventRequestStatusBadge';
import { getAssignmentRecord, listAssignableCoordinators, type AssignmentRecord } from '@/domain/assignment/service';
import { canBeAssigned } from '@/domain/assignment/policy';
import { describeEventTimes } from '@/domain/event-request/policy';
import { isActionPermitted } from '@/domain/identity/permissions';
import { NotFoundError } from '@/domain/shared/errors';
import { formatSingaporeDate, formatSingaporeDateTime } from '@/domain/shared/dates';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-232 — one event's assignment, for the Event Coordinator Lead.
 *
 * AC2 — the request's details, as in the queue row it was opened from.
 * AC3 — who it is assigned to, who assigned it and when, and every earlier
 * assignment with who reassigned it and when. Assigning (SCRUM-94's form) and
 * reassigning (SCRUM-96's endpoint) are both done here, so the record is shown
 * on the same page right after the change.
 * AC4 — anyone without the Lead's permission is told the page is not for their
 * role, and no assign or reassign control is rendered for them.
 */

export const dynamic = 'force-dynamic';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-[var(--border)] py-3 last:border-b-0">
      <dt className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">{label}</dt>
      <dd className="mt-1 text-sm">{value}</dd>
    </div>
  );
}

const byWhom = (name: string | null) => name ?? 'an unnamed account';

export default async function EventAssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentActor();
  // The same permission the assign and reassign routes assert.
  if (!isActionPermitted(actor.roles, 'coordinator_assignment')) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl font-semibold">Event assignment</h1>
        <p className="mt-4 text-[var(--text-muted)]">
          This page is for the Event Coordinator Lead. Your account does not currently hold that role.
        </p>
      </main>
    );
  }

  const { id } = await params;
  let record: AssignmentRecord;
  try {
    record = await getAssignmentRecord(id, actor);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const coordinators = await listAssignableCoordinators();
  const { event, current, history } = record;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/assignment-queue" className="text-sm text-[var(--brand)] hover:underline">
        ← Assignment queue
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{event.name}</h1>
        <EventRequestStatusBadge status={event.status} />
      </div>
      <p className="mt-1 font-mono text-xs text-[var(--text-muted)]">{event.reference}</p>

      <dl className="mt-6 rounded border border-[var(--border)] bg-[var(--surface)] px-4">
        <Row label="Client organisation" value={event.clientOrganisation?.name ?? 'Not linked'} />
        <Row label="Proposed date" value={event.proposedDate ? formatSingaporeDate(event.proposedDate) : 'Not yet provided'} />
        <Row label="Time" value={describeEventTimes(event.startTime, event.endTime)} />
        <Row
          label="Expected attendance"
          value={event.expectedAttendance === null ? 'Not yet provided' : String(event.expectedAttendance)}
        />
        <Row label="Submitted" value={event.submittedAt ? formatSingaporeDateTime(event.submittedAt) : 'Not submitted'} />
      </dl>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Coordinator</h2>
        {current ? (
          <div className="mt-3 space-y-4">
            <p className="text-sm">
              Assigned to <strong>{current.coordinatorName ?? 'an unnamed coordinator'}</strong> by{' '}
              {byWhom(current.assignedByName)} on {formatSingaporeDateTime(current.assignedAt)}.
            </p>
            <ReassignCoordinatorForm
              eventRequestId={event.id}
              currentCoordinatorId={current.coordinatorId}
              coordinators={coordinators}
            />
          </div>
        ) : canBeAssigned(event.status, null) ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-[var(--text-muted)]">No coordinator has been assigned yet.</p>
            <AssignCoordinatorForm eventRequestId={event.id} coordinators={coordinators} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-[var(--text-muted)]">
            No coordinator is assigned, and only a submitted event can be assigned one.
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Assignment history</h2>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--text-muted)]">This event has not been reassigned.</p>
        ) : (
          <ol className="mt-3 space-y-2 text-sm">
            {history.map((entry) => (
              <li key={entry.replacedAt} className="rounded border border-[var(--border)] bg-[var(--surface)] p-3">
                {entry.coordinatorName ?? 'An unnamed coordinator'} (assigned by {byWhom(entry.assignedByName)} on{' '}
                {formatSingaporeDateTime(entry.assignedAt)}) was replaced by{' '}
                {entry.replacedByCoordinatorName ?? 'an unnamed coordinator'} — reassigned by{' '}
                {byWhom(entry.replacedByName)} on {formatSingaporeDateTime(entry.replacedAt)}.
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
