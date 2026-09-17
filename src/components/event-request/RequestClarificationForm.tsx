'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * SCRUM-90 AC1/AC3 (US-7.2-TC01) — the Coordinator's "enter clarification
 * message" / "Send" action. Same request/response shape as
 * SubmitEventRequestButton: on success the page is refreshed so the new
 * status comes from the server; on refusal the message from
 * RequestClarificationInputSchema (e.g. a blank note) is shown as-is.
 */
export function RequestClarificationForm({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/event-requests/${requestId}/clarification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.message ?? 'The clarification request could not be sent.');
      }
      setNote('');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The clarification request could not be sent.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block text-sm font-medium" htmlFor="clarification-note">
        Ask the Organiser for clarification
      </label>
      <textarea
        id="clarification-note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={3}
        className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        placeholder="What do you need to know before this can proceed?"
      />
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
        {submitting ? 'Sending...' : 'Send'}
      </button>
    </form>
  );
}
