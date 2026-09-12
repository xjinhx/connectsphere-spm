'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { IncompleteField } from '@/domain/event-request/policy';

/**
 * SCRUM-82 — the Submit action on a draft.
 *
 * AC1: on success the page is refreshed, so the new status and submission time
 * come from the server rather than being guessed here.
 * AC2: on refusal every incomplete field is listed by name, and nothing else
 * changes - the draft is exactly as it was.
 */
export function SubmitEventRequestButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incomplete, setIncomplete] = useState<IncompleteField[]>([]);

  async function onSubmit() {
    setSubmitting(true);
    setError(null);
    setIncomplete([]);
    try {
      const response = await fetch(`/api/event-requests/${requestId}/submit`, { method: 'POST' });
      const payload = (await response.json().catch(() => null)) as {
        status?: string;
        message?: string;
        details?: { incompleteFields?: IncompleteField[] };
      } | null;

      if (!response.ok || payload?.status !== 'SUBMITTED') {
        setIncomplete(payload?.details?.incompleteFields ?? []);
        throw new Error(payload?.message ?? 'The request could not be submitted.');
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The request could not be submitted.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      {error ? (
        <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--danger)]">
          <p>{error}</p>
          {incomplete.length > 0 ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-5">
              {incomplete.map((item) => (
                <li key={item.field}>
                  <span className="font-medium">{item.label}</span>
                  <span className="text-[var(--text-muted)]"> — {item.reason}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
      >
        {submitting ? 'Submitting...' : 'Submit request'}
      </button>
    </div>
  );
}
