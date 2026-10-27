'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatSingaporeDateTime } from '@/domain/shared/dates';
import { eventNeedsReview } from '@/domain/significant-change/policy';
import type { ArrangementSummary, EventScheduleView } from '@/domain/significant-change/schema';

/**
 * SCRUM-111 AC8, AC9 — the arrangements a significant change has marked for
 * review, near the top of the coordinator's page because they need acting on.
 *
 * AC9: the assigned coordinator marks each one re-confirmed; the flag clears
 * and who did it and when are saved. AC8: once every one is re-confirmed the
 * list is gone, and the page says so. The Lead sees the list without the
 * button (view.canEdit is the assigned coordinator only).
 *
 * Renders nothing for an event none of whose arrangements has ever been
 * flagged.
 */
export function ArrangementReviewPanel({ requestId, view }: { requestId: string; view: EventScheduleView }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const arrangements = [...view.bookings, ...view.reservations];
  const flagged = arrangements.filter((arrangement) => arrangement.reviewRequired);
  const reconfirmed = arrangements.filter((arrangement) => !arrangement.reviewRequired && arrangement.reconfirmedAt);

  if (flagged.length === 0 && reconfirmed.length === 0) return null;

  async function reconfirm(arrangement: ArrangementSummary) {
    setBusy(arrangement.id);
    setError(null);
    try {
      const response = await fetch(`/api/event-requests/${requestId}/arrangement-reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: arrangement.kind, id: arrangement.id }),
      });
      if (response.status === 401) throw new Error('Your session has expired. Log in again, then re-confirm.');
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? 'The arrangement could not be re-confirmed.');
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The arrangement could not be re-confirmed.');
    } finally {
      setBusy(null);
    }
  }

  const kindLabel = (arrangement: ArrangementSummary) =>
    arrangement.kind === 'venue_booking' ? 'Venue booking' : 'Equipment reservation';

  return (
    <section
      aria-labelledby="arrangement-review-heading"
      className={`mt-4 rounded-md border px-3 py-2 text-sm ${
        eventNeedsReview(arrangements) ? 'border-[var(--warning)] bg-amber-50' : 'border-[var(--border)] bg-[var(--surface)]'
      }`}
    >
      <h2 id="arrangement-review-heading" className="font-medium">
        {flagged.length > 0 ? 'Arrangements to review' : 'Arrangements re-confirmed'}
      </h2>
      {flagged.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {flagged.map((arrangement) => (
            <li key={arrangement.id} className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p>
                  <span className="font-medium">{kindLabel(arrangement)}:</span> {arrangement.label}
                </p>
                <p className="text-[var(--warning)]">
                  Review required: {arrangement.reviewRequiredCause}
                  {arrangement.reviewRequiredAt ? ` (${formatSingaporeDateTime(arrangement.reviewRequiredAt)})` : ''}
                </p>
              </div>
              {view.canEdit ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => reconfirm(arrangement)}
                  className="rounded-md border border-[var(--border)] bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
                >
                  {busy === arrangement.id ? 'Re-confirming...' : 'Mark re-confirmed'}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[var(--text-muted)]">No arrangement needs review.</p>
      )}
      {reconfirmed.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
          {reconfirmed.map((arrangement) => (
            <li key={arrangement.id}>
              {kindLabel(arrangement)}: {arrangement.label}, re-confirmed by {arrangement.reconfirmedByName}
              {arrangement.reconfirmedAt ? ` on ${formatSingaporeDateTime(arrangement.reconfirmedAt)}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </section>
  );
}
