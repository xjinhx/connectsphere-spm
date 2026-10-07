'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Decision = 'approve' | 'reject';

/**
 * SCRUM-148 AC1 and AC5 — Venue Staff approve or reject each line of a pending
 * booking request, a rejected line with a reason, then confirm once.
 *
 * Same request/response shape as RejectRequestForm: on success the page is
 * refreshed so each line's decision, decider and time come from the server; on
 * refusal the API's message is shown as-is (e.g. "A reason is required for each
 * rejected line.").
 *
 * The decider is never sent from here. The route reads whoever is signed in.
 *
 * SCRUM-155 AC2: a line that clashes with a confirmed booking or an
 * unavailable slot says what with, and offers Reject only. The API refuses an
 * approval of it anyway, for everyone.
 */
export function VenueBookingDecisionForm({
  requestId,
  lines,
}: {
  requestId: string;
  lines: readonly { id: string; label: string; blockedReason?: string }[];
}) {
  const router = useRouter();
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    // Only lines given a decision are sent. A line left undecided is refused by
    // the API, which says so.
    const body = lines.flatMap((line): { lineId: string; decision: Decision; reason?: string }[] => {
      const decision = decisions[line.id];
      if (!decision) return [];
      return [decision === 'reject' ? { lineId: line.id, decision, reason: reasons[line.id] ?? '' } : { lineId: line.id, decision }];
    });
    try {
      const response = await fetch(`/api/venue-booking-requests/${requestId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisions: body }),
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.message ?? 'The decision could not be saved.');
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The decision could not be saved.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {lines.map((line) => (
        <fieldset key={line.id} className="rounded-md border border-[var(--border)] p-3">
          <legend className="px-1 text-sm font-medium">{line.label}</legend>
          {line.blockedReason ? (
            <p className="mb-2 text-sm text-[var(--danger)]">{line.blockedReason} It cannot be approved.</p>
          ) : null}
          <div className="flex gap-6">
            {(line.blockedReason ? (['reject'] as const) : (['approve', 'reject'] as const)).map((decision) => (
              <label key={decision} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`decision-${line.id}`}
                  checked={decisions[line.id] === decision}
                  onChange={() => setDecisions((current) => ({ ...current, [line.id]: decision }))}
                />
                {decision === 'approve' ? 'Approve' : 'Reject'}
              </label>
            ))}
          </div>
          {decisions[line.id] === 'reject' ? (
            <div className="mt-3">
              <label className="block text-xs text-[var(--text-muted)]" htmlFor={`reason-${line.id}`}>
                Reason for rejecting
              </label>
              <input
                id={`reason-${line.id}`}
                type="text"
                value={reasons[line.id] ?? ''}
                onChange={(event) => setReasons((current) => ({ ...current, [line.id]: event.target.value }))}
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              />
            </div>
          ) : null}
        </fieldset>
      ))}

      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
      >
        {submitting ? 'Saving...' : 'Confirm decision'}
      </button>
    </form>
  );
}
