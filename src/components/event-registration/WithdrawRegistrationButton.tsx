'use client';

import { useState } from 'react';
import type { Registration } from '@/domain/event-registration/schema';

/**
 * SCRUM-184 AC1 — Withdraw, then confirm. Nothing is sent until the attendee
 * confirms; Keep my registration closes the prompt and changes nothing
 * (TC-184-02). On success `onWithdrawn` gets the registration, now Withdrawn.
 *
 * The API decides whether the withdrawal is allowed; this only shows what it says.
 */
export function WithdrawRegistrationButton({
  eventRequestId,
  registrationId,
  eventName,
  onWithdrawn,
}: {
  eventRequestId: string;
  registrationId: string;
  eventName: string;
  onWithdrawn: (registration: Registration) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withdraw() {
    // One request at a time; the database also stops a second withdrawal (TC-184-03).
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/events/${eventRequestId}/registrations/${registrationId}/withdraw`, {
        method: 'POST',
      });
      const payload = (await response.json().catch(() => null)) as (Registration & { message?: string }) | null;
      if (response.ok && payload) {
        onWithdrawn(payload);
        return;
      }
      setError(payload?.message ?? 'Your registration could not be withdrawn.');
    } catch {
      setError('Your registration could not be withdrawn.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-[var(--danger)] px-3 py-1.5 text-sm font-medium text-[var(--danger)]"
      >
        Withdraw
      </button>
    );
  }

  return (
    <div role="alertdialog" aria-label="Confirm withdrawal" className="space-y-3 rounded-lg border border-[var(--border)] p-3 text-sm">
      <p>Withdraw from {eventName}? Your place will be released for someone else.</p>
      {error ? (
        <p role="alert" className="text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={withdraw}
          disabled={submitting}
          className="rounded-md bg-[var(--danger)] px-3 py-1.5 font-medium text-white disabled:opacity-60"
        >
          {submitting ? 'Withdrawing...' : 'Yes, withdraw'}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
          disabled={submitting}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 font-medium"
        >
          Keep my registration
        </button>
      </div>
    </div>
  );
}
