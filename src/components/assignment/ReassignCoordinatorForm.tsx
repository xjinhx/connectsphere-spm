'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AssignableCoordinator } from '@/domain/assignment/service';

/**
 * SCRUM-232 AC3 — the Lead reassigns an event to another coordinator, through
 * SCRUM-96's existing PATCH /coordinator endpoint. SCRUM-96 built the endpoint
 * but no screen for it; this is that screen, and the endpoint is unchanged.
 *
 * The current coordinator is left out of the list: reassigning to the same
 * person is refused by the API (canBeReassigned), so offering it would only
 * lead to an error. fromCoordinatorId is the coordinator this page was showing,
 * so a reassignment someone else made in the meantime is refused by the API
 * (SCRUM-215) and its message is shown here as sent.
 */
export function ReassignCoordinatorForm({
  eventRequestId,
  currentCoordinatorId,
  coordinators,
}: {
  eventRequestId: string;
  currentCoordinatorId: string;
  coordinators: readonly AssignableCoordinator[];
}) {
  const router = useRouter();
  const [coordinatorId, setCoordinatorId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choices = coordinators.filter((coordinator) => coordinator.id !== currentCoordinatorId);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await fetch(`/api/event-requests/${eventRequestId}/coordinator`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ coordinatorId, fromCoordinatorId: currentCoordinatorId }),
      });
      const payload = (await result.json().catch(() => null)) as { message?: string } | null;
      if (!result.ok) throw new Error(payload?.message ?? 'The coordinator could not be reassigned.');
      setCoordinatorId('');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The coordinator could not be reassigned.');
    } finally {
      setSaving(false);
    }
  }

  if (choices.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        There is no other Event Coordinator to reassign this event to.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <label htmlFor={`reassign-${eventRequestId}`} className="block text-sm font-medium">
        Reassign to
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          id={`reassign-${eventRequestId}`}
          name="coordinatorId"
          value={coordinatorId}
          onChange={(event) => setCoordinatorId(event.target.value)}
          className="rounded-md border border-[var(--border)] bg-white px-2 py-1.5 text-sm"
        >
          <option value="">Choose a coordinator…</option>
          {choices.map((coordinator) => (
            <option key={coordinator.id} value={coordinator.id}>
              {coordinator.name ?? 'Name not recorded'}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={saving || coordinatorId === ''}
          className="rounded-md bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
        >
          {saving ? 'Reassigning…' : 'Reassign'}
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
