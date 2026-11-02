'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CANCELLATION_REASON_MAX_LENGTH } from '@/domain/event-status/schema';

/**
 * SCRUM-105 AC1 — "when I cancel it and enter a reason". Cancel event opens a
 * reason box; Confirm cancellation posts it to the cancel route. The second
 * step is deliberate: cancelling releases every booking and reservation and
 * cannot be undone.
 *
 * On success the page is refreshed, so the Cancelled badge, the reason, who
 * and when come from the server, the same as CompleteEventButton. On refusal
 * the API's message is shown as worded.
 */
export function CancelEventForm({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    setCancelling(true);
    setError(null);
    try {
      const response = await fetch(`/api/event-requests/${requestId}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const payload = (await response.json().catch(() => null)) as { status?: string; message?: string } | null;
      if (!response.ok || payload?.status !== 'cancelled') {
        throw new Error(payload?.message ?? 'The event could not be cancelled.');
      }
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The event could not be cancelled.');
    } finally {
      setCancelling(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-[var(--danger)] px-4 py-2 text-sm font-medium text-[var(--danger)] hover:bg-red-50"
      >
        Cancel event
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">
        Cancelling releases every venue booking and equipment reservation, and tells the organiser, the staff
        involved and registered attendees. It cannot be undone.
      </p>
      <label htmlFor="cancel-reason" className="block text-sm font-medium">
        Reason
      </label>
      <textarea
        id="cancel-reason"
        rows={3}
        maxLength={CANCELLATION_REASON_MAX_LENGTH}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
        placeholder="Why is the event being cancelled?"
      />

      {error ? (
        <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onConfirm}
          disabled={cancelling}
          className="rounded-md bg-[var(--danger)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {cancelling ? 'Cancelling...' : 'Confirm cancellation'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={cancelling}
          className="rounded-md border border-[var(--border)] bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
        >
          Keep event
        </button>
      </div>
    </div>
  );
}
