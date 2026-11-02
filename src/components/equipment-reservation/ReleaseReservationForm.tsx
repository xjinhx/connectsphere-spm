'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * SCRUM-177 AC1 — Technical Support Staff release one reservation, giving a
 * reason. Release opens the reason box; nothing is sent until it is confirmed.
 * The same shape as ReleaseVenueBookingForm (SCRUM-231).
 *
 * On success the page is refreshed, so the row shows Released with its reason
 * and date (AC5) and the line is outstanding again. On refusal the API's
 * message is shown as-is (e.g. "A reason is required to release a
 * reservation."). The releaser is never sent from here; the route reads
 * whoever is signed in.
 */
export function ReleaseReservationForm({
  eventRequestId,
  reservationId,
}: {
  eventRequestId: string;
  reservationId: string;
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
      const response = await fetch(
        `/api/event-requests/${eventRequestId}/equipment-reservations/${reservationId}/release`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        },
      );
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.message ?? 'The reservation could not be released.');
      }
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The reservation could not be released.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-[var(--danger)] hover:underline"
      >
        Release
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <label className="block text-xs text-[var(--text-muted)]" htmlFor={`release-reason-${reservationId}`}>
        Reason
      </label>
      <input
        id={`release-reason-${reservationId}`}
        type="text"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
      />

      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-[var(--danger)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {submitting ? 'Releasing...' : 'Release reservation'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
