'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * SCRUM-231 AC1 — the event's coordinator releases one booking, giving a
 * reason. Release opens the reason box; nothing is sent until it is confirmed.
 *
 * On success the page is refreshed, so the booking shows Released and an
 * affected booking's outstanding action is gone (AC4). On refusal the API's
 * message is shown as-is (e.g. "A reason is required to release a booking.").
 * The releaser is never sent from here; the route reads whoever is signed in.
 */
export function ReleaseVenueBookingForm({ bookingId }: { bookingId: string }) {
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
      const response = await fetch(`/api/venue-bookings/${bookingId}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.message ?? 'The booking could not be released.');
      }
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The booking could not be released.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-sm font-medium text-[var(--danger)] hover:underline"
      >
        Release
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-2 space-y-2">
      <label className="block text-xs text-[var(--text-muted)]" htmlFor={`release-reason-${bookingId}`}>
        Reason for releasing
      </label>
      <input
        id={`release-reason-${bookingId}`}
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
          {submitting ? 'Releasing...' : 'Confirm release'}
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
