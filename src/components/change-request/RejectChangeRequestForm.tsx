'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * SCRUM-191 AC1/AC4 - a reason textbox and a confirm action for the
 * assigned coordinator to reject a Pending change request. Rendered on the
 * coordinator's review page (src/app/events/[id]/review/page.tsx).
 */
export function RejectChangeRequestForm({
  eventRequestId,
  changeRequestId,
  onRejected,
}: {
  eventRequestId: string;
  changeRequestId: string;
  onRejected?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await fetch(
        `/api/event-requests/${eventRequestId}/change-requests/${changeRequestId}/reject`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason }),
        },
      );
      const payload = (await result.json().catch(() => null)) as { message?: string } | null;
      if (!result.ok) {
        // AC4 — the server's "a reason is required" message (or any other
        // refusal) is shown as-is, rather than re-deriving it client-side.
        throw new Error(payload?.message ?? 'The change request could not be rejected.');
      }

      setOpen(false);
      setReason('');
      onRejected?.();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The change request could not be rejected.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-[var(--danger)] bg-white px-3 py-1.5 text-sm font-medium text-[var(--danger)] hover:bg-red-50"
      >
        Reject
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-2 space-y-3 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
      <div>
        <label htmlFor={`reject-reason-${changeRequestId}`} className="block text-sm font-medium">
          Reason
        </label>
        <textarea
          id={`reject-reason-${changeRequestId}`}
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="mt-1 w-full rounded-md border border-[var(--border)] bg-white px-2 py-1 text-sm"
          placeholder="Why is this change being rejected?"
        />
      </div>

      {error ? (
        <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-[var(--danger)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? 'Rejecting...' : 'Confirm rejection'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-[var(--border)] bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
