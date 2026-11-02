'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * SCRUM-104 AC1 — "when I mark it completed". Posts to the complete route with
 * nothing in the body: the completer is whoever is signed in.
 *
 * On success the page is refreshed, so the Completed badge and who completed
 * it come from the server, the same as ConfirmEventButton. On refusal the API's
 * message is shown as worded (AC4, AC5).
 */
export function CompleteEventButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onComplete() {
    setCompleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/event-requests/${requestId}/complete`, { method: 'POST' });
      const payload = (await response.json().catch(() => null)) as {
        status?: string;
        message?: string;
      } | null;
      if (!response.ok || payload?.status !== 'completed') {
        throw new Error(payload?.message ?? 'The event could not be marked completed.');
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The event could not be marked completed.');
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div className="space-y-3">
      {error ? (
        <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onComplete}
        disabled={completing}
        className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
      >
        {completing ? 'Marking...' : 'Mark as completed'}
      </button>
    </div>
  );
}
