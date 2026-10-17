'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SAFETY_CHECK_DECISION_LABELS, type SafetyCheckDecision } from '@/domain/safety-check/schema';

/**
 * SCRUM-234 AC3-AC5 — the Safety Officer's decision: approve, request changes
 * with a note, or reject with a reason. On success the page is refreshed so
 * the new status and the recorded decision come from the server; on refusal
 * the message from RecordSafetyCheckInputSchema (e.g. a blank note) is shown
 * as-is.
 */
const NOTE_PROMPT: Record<Exclude<SafetyCheckDecision, 'approved'>, { label: string; placeholder: string }> = {
  changes_requested: { label: 'Note for the coordinator', placeholder: 'What needs to change before it is safe to run?' },
  rejected: { label: 'Reason', placeholder: 'Why is this event being rejected?' },
};

export function SafetyCheckDecisionForm({ eventRequestId }: { eventRequestId: string }) {
  const router = useRouter();
  const [decision, setDecision] = useState<SafetyCheckDecision>('approved');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/event-requests/${eventRequestId}/safety-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(decision === 'approved' ? { decision } : { decision, note }),
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) throw new Error(payload?.message ?? 'The decision could not be recorded.');
      setNote('');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The decision could not be recorded.');
    } finally {
      setSubmitting(false);
    }
  }

  const prompt = decision === 'approved' ? null : NOTE_PROMPT[decision];

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <fieldset>
        <legend className="text-sm font-medium">Decision</legend>
        <div className="mt-2 flex flex-wrap gap-4">
          {(Object.keys(SAFETY_CHECK_DECISION_LABELS) as SafetyCheckDecision[]).map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="safety-decision"
                value={value}
                checked={decision === value}
                onChange={() => {
                  setDecision(value);
                  setError(null);
                }}
              />
              {value === 'approved' ? 'Approve' : value === 'changes_requested' ? 'Request changes' : 'Reject'}
            </label>
          ))}
        </div>
      </fieldset>

      {prompt ? (
        <div>
          <label className="block text-sm font-medium" htmlFor="safety-note">
            {prompt.label}
          </label>
          <textarea
            id="safety-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            placeholder={prompt.placeholder}
          />
        </div>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">Approving moves the event to Preparation.</p>
      )}

      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={submitting}
        className={`rounded-md px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 ${
          decision === 'rejected' ? 'bg-[var(--danger)]' : 'bg-[var(--brand)]'
        }`}
      >
        {submitting ? 'Saving...' : 'Save decision'}
      </button>
    </form>
  );
}
