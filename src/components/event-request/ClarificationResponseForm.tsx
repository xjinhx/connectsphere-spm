'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { IncompleteField } from '@/domain/event-request/policy';

/**
 * SCRUM-91 AC1 — "when I amend it and resubmit, then its status returns to
 * Submitted and the assigned coordinator is notified."
 *
 * The amendment happens through the existing edit page (SCRUM-83/85), linked
 * beside this form: a request in Clarification Requested is already editable.
 * This is the answer that travels with the resubmission.
 *
 * It replaces SCRUM-82's plain Submit button while a clarification is open, and
 * deliberately so: that button posts straight to /submit, which would send the
 * request back with the coordinator's question still unanswered. Routing the
 * resubmission through here is what makes "a response is required" true of the
 * screen and not only of the API.
 *
 * On success the page is refreshed rather than updated from here, so the new
 * status and the closed round come from the server (same reasoning as
 * SubmitEventRequestButton).
 */
export function ClarificationResponseForm({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [response, setResponse] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incomplete, setIncomplete] = useState<IncompleteField[]>([]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setIncomplete([]);
    try {
      const result = await fetch(`/api/event-requests/${requestId}/clarification-rounds`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ response }),
      });
      const payload = (await result.json().catch(() => null)) as {
        status?: string;
        message?: string;
        details?: {
          incompleteFields?: IncompleteField[];
          fieldErrors?: { response?: string[] };
        };
      } | null;

      if (!result.ok || payload?.status !== 'submitted') {
        // SCRUM-82 AC2 still applies to a resubmission: if a mandatory field is
        // incomplete the request is refused and every one is named, so the
        // organiser knows what to go back and fix.
        setIncomplete(payload?.details?.incompleteFields ?? []);
        // A refusal about the response itself carries the reason on the field
        // ("A response to the clarification is required"), which is what the
        // person needs to read. The envelope message above it only says the
        // response is not valid, which does not tell them what to do.
        const fieldError = payload?.details?.fieldErrors?.response?.[0];
        throw new Error(fieldError ?? payload?.message ?? 'The response could not be sent.');
      }
      setResponse('');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The response could not be sent.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label htmlFor="clarification-response" className="block text-sm font-medium">
          Your response
        </label>
        <p className="mt-0.5 text-sm text-[var(--text-muted)]">
          Answer the coordinator&apos;s question. Change any details they asked about first, then
          send your reply — this puts the request back in front of them.
        </p>
        <textarea
          id="clarification-response"
          name="response"
          rows={4}
          value={response}
          onChange={(event) => setResponse(event.target.value)}
          className="mt-2 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
          placeholder="Expected attendance is now 200."
        />
      </div>

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

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
        >
          {submitting ? 'Sending...' : 'Send response and resubmit'}
        </button>
        <Link
          href={`/events/${requestId}/edit`}
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium hover:bg-slate-50"
        >
          Change the details
        </Link>
      </div>
    </form>
  );
}
