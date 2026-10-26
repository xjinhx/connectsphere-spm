import { CHANGE_REQUEST_FIELD_LABELS, CHANGE_REQUEST_STATUS_LABELS } from '@/domain/change-request/schema';
import type { ChangeRequestSummary } from '@/domain/change-request/service';
import { formatSingaporeDateTime } from '@/domain/shared/dates';

/**
 * SCRUM-187 AC6 / SCRUM-188 AC1 — one change request's current vs proposed
 * value for each field, its reason, status and (once decided) the decision
 * date and reason.
 *
 * Shared by the organiser's event page (src/app/events/[id]/page.tsx) and
 * the coordinator's review page (src/app/events/[id]/review/page.tsx), so
 * TC-188-02's "the same detail view opens from its notification" is true in
 * the plainest possible sense: it is the same component, not a
 * lookalike. Each page's own access rule (canViewRequest vs
 * listChangeRequestsForCoordinator) decides what list it is handed; this
 * component only renders what it is given.
 */
export function ChangeRequestList({ changeRequests }: { changeRequests: ChangeRequestSummary[] }) {
  if (changeRequests.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold">Change requests</h2>
      <ul className="mt-2 space-y-3">
        {changeRequests.map((cr) => (
          <li
            key={cr.id}
            id={`change-request-${cr.id}`}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{CHANGE_REQUEST_STATUS_LABELS[cr.status]}</span>
              <span className="text-xs text-[var(--text-muted)]">
                Raised {formatSingaporeDateTime(cr.createdAt)}
              </span>
            </div>
            <ul className="mt-2 space-y-1">
              {cr.fields.map((field) => (
                <li key={field.field}>
                  <span className="font-medium">{CHANGE_REQUEST_FIELD_LABELS[field.field]}:</span>{' '}
                  {String(field.currentValue ?? '—')} → {String(field.proposedValue ?? '—')}
                </li>
              ))}
            </ul>
            <p className="mt-2 whitespace-pre-wrap">{cr.reason}</p>
            {cr.decidedAt ? (
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Decided {formatSingaporeDateTime(cr.decidedAt)}
                {cr.decisionReason ? ` — ${cr.decisionReason}` : ''}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
