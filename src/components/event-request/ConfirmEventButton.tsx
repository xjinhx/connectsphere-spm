'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * SCRUM-102 — "when I attempt to confirm the event". Posts to the confirm
 * route with nothing in the body: the confirmer is whoever is signed in.
 *
 * On success the page is refreshed, so the Confirmed badge comes from the
 * server (TC-102-08), the same as ApproveRequestButton. On refusal the API's
 * message is shown as worded: it names every essential arrangement still
 * outstanding, one per line (AC1, AC2).
 */
export function ConfirmEventButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    setConfirming(true);
    setError(null);
    try {
      const response = await fetch(`/api/event-requests/${requestId}/confirm`, { method: 'POST' });
      const payload = (await response.json().catch(() => null)) as {
        status?: string;
        message?: string;
      } | null;
      if (!response.ok || payload?.status !== 'confirmed') {
        throw new Error(payload?.message ?? 'The event could not be confirmed.');
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The event could not be confirmed.');
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="space-y-3">
      {error ? (
        <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm whitespace-pre-line text-[var(--danger)]">
          {error}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onConfirm}
        disabled={confirming}
        className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
      >
        {confirming ? 'Confirming...' : 'Confirm event'}
      </button>
    </div>
  );
}
