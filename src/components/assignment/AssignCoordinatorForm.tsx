'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AssignableCoordinator } from '@/domain/assignment/service';

/**
 * SCRUM-94 AC1 — assign an Event Coordinator to a submitted event, from the
 * queue of events waiting for one (SCRUM-95's page).
 *
 * One of these per row. The coordinators are passed in by the page rather than
 * fetched here, so the list is read once for the whole table instead of once
 * per event.
 *
 * AC5 — when two managers assign the same event at the same moment, the second
 * is told the event is already assigned and to whom. That message comes from the
 * API (a 409 naming the holder) and is shown here as it was sent, rather than
 * being rewritten into something vaguer.
 *
 * On success the page is refreshed, so the row leaves the queue because the
 * server says it has, not because this component hid it (same reasoning as
 * SubmitEventRequestButton).
 */
export function AssignCoordinatorForm({
  eventRequestId,
  coordinators,
}: {
  eventRequestId: string;
  coordinators: readonly AssignableCoordinator[];
}) {
  const router = useRouter();
  const [coordinatorId, setCoordinatorId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectId = `assign-${eventRequestId}`;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setAssigning(true);
    setError(null);
    try {
      const result = await fetch(`/api/event-requests/${eventRequestId}/coordinator`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ coordinatorId }),
      });
      const payload = (await result.json().catch(() => null)) as {
        coordinatorId?: string;
        message?: string;
      } | null;

      if (!result.ok) throw new Error(payload?.message ?? 'The coordinator could not be assigned.');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The coordinator could not be assigned.');
    } finally {
      setAssigning(false);
    }
  }

  if (coordinators.length === 0) {
    return (
      <p className="text-xs text-[var(--text-muted)]">
        No Event Coordinators exist yet, so there is nobody to assign.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Labelled but not visibly, because the column heading already says
            what this is and a label per row would repeat it eleven times. */}
        <label htmlFor={selectId} className="sr-only">
          Coordinator for this event
        </label>
        <select
          id={selectId}
          name="coordinatorId"
          value={coordinatorId}
          onChange={(event) => setCoordinatorId(event.target.value)}
          className="rounded-md border border-[var(--border)] bg-white px-2 py-1.5 text-sm"
        >
          <option value="">Choose a coordinator…</option>
          {coordinators.map((coordinator) => (
            <option key={coordinator.id} value={coordinator.id}>
              {coordinator.name ?? coordinator.email ?? 'Name not recorded'}
            </option>
          ))}
        </select>

        <button
          type="submit"
          // Nothing chosen is not an error worth reporting: the button simply
          // is not ready yet. A blank id would be refused by the API anyway.
          disabled={assigning || coordinatorId === ''}
          className="rounded-md bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
        >
          {assigning ? 'Assigning…' : 'Assign'}
        </button>
      </div>

      {error ? (
        <p role="alert" className="rounded-md bg-red-50 px-2 py-1 text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </form>
  );
}
