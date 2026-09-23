'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { COMMITMENT_STATEMENT } from '@/domain/review/policy';

/**
 * SCRUM-92 AC1 — "Given I am reviewing a submitted request, when I approve it,
 * then its status changes to Approved and the decision, decision maker and
 * timestamp are recorded."
 *
 * This is "when I approve it". It posts to SCRUM-92's own approve endpoint and
 * changes nothing about the review page it sits on, the same way SCRUM-94's
 * Assign action was added to SCRUM-95's queue page.
 *
 * Nothing is sent in the body. The decision maker is whoever is signed in, read
 * from the session by the route (getCurrentActor), so the approver cannot be
 * chosen from the browser.
 *
 * On success the page is refreshed rather than updated from here, so the new
 * status and the approval date come from the server (same reasoning as
 * SubmitEventRequestButton).
 */
export function ApproveRequestButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onApprove() {
    setApproving(true);
    setError(null);
    try {
      const response = await fetch(`/api/event-requests/${requestId}/approve`, { method: 'POST' });
      const payload = (await response.json().catch(() => null)) as {
        status?: string;
        message?: string;
      } | null;

      // The refusals this can hit are all real situations, not bugs: the
      // request was decided by someone else a moment ago (409), or an Event
      // Operations Manager reassigned it away while this page was open (403,
      // SCRUM-213). Both are shown as the API worded them, because the reason
      // is what tells the coordinator whether to reload or to stop.
      if (!response.ok || payload?.status !== 'approved') {
        throw new Error(payload?.message ?? 'The request could not be approved.');
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The request could not be approved.');
    } finally {
      setApproving(false);
    }
  }

  return (
    <div className="space-y-3">
      {error ? (
        <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </div>
      ) : null}

      <div>
        <button
          type="button"
          onClick={onApprove}
          disabled={approving}
          className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
        >
          {approving ? 'Approving...' : 'Approve request'}
        </button>
        {/* AC1's "without committing ConnectSphere to any arrangement yet",
            said before the decision rather than only after it, so the
            coordinator knows what approving does and does not do. The wording
            is the domain's (COMMITMENT_STATEMENT), not a second copy. */}
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Approving lets planning begin. {COMMITMENT_STATEMENT}
        </p>
      </div>
    </div>
  );
}
