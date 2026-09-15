import { getCoordinatorView } from '@/domain/assignment/service';
import { formatSingaporeDateTime } from '@/domain/shared/dates';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * The coordinator handling an event, shown on the organiser's event page.
 *
 * SCRUM-98 AC1 full name, ConnectSphere email and contact number
 * SCRUM-98 AC2 "A coordinator has not yet been assigned" when there is none
 * SCRUM-98 AC3 after a reassignment, the new coordinator (read fresh each time)
 * SCRUM-96 AC3 previous coordinators stay listed in the event's history
 *
 * A server component that fetches its own data, so the event page only has to
 * place it. Access is decided in getCoordinatorView; the page it sits on is
 * already limited to the organiser who owns the event.
 */

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-[var(--border)] py-3 last:border-b-0">
      <dt className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">{label}</dt>
      <dd className="mt-1 text-sm">{value}</dd>
    </div>
  );
}

export default async function CoordinatorPanel({ eventRequestId }: { eventRequestId: string }) {
  const actor = await getCurrentActor();
  const view = await getCoordinatorView(eventRequestId, actor);

  return (
    <section className="mt-6" aria-labelledby="coordinator-heading">
      <h2 id="coordinator-heading" className="mb-2 text-base font-semibold">
        Your coordinator
      </h2>

      {view.current ? (
        <dl className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4">
          <Line label="Name" value={view.current.fullName ?? 'Name not recorded'} />
          <Line label="Email" value={view.current.email ?? 'Not recorded'} />
          <Line label="Contact number" value={view.current.contactNumber ?? 'Not recorded'} />
          {view.assignedAt ? (
            <Line label="Assigned" value={formatSingaporeDateTime(view.assignedAt)} />
          ) : null}
        </dl>
      ) : (
        <p className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-muted)]">
          A coordinator has not yet been assigned.
        </p>
      )}

      {view.history.length > 0 ? (
        <div className="mt-4">
          <h3 className="mb-1 text-sm font-medium">Previous coordinators</h3>
          <ul className="space-y-1 text-sm text-[var(--text-muted)]">
            {view.history.map((entry) => (
              <li key={`${entry.coordinatorId}-${entry.replacedAt}`}>
                {entry.coordinatorName ?? 'Name not recorded'}, assigned{' '}
                {formatSingaporeDateTime(entry.assignedAt)}, replaced{' '}
                {formatSingaporeDateTime(entry.replacedAt)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
