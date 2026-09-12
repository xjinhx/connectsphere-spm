import Link from 'next/link';
import { EventRequestStatusBadge } from '@/components/event-request/EventRequestStatusBadge';
import { submissionSummary } from '@/domain/event-request/policy';
import { listMyEventRequests } from '@/domain/event-request/service';

// Depends on who is signed in, so there is nothing to prerender at build time.
export const dynamic = 'force-dynamic';

/**
 * SCRUM-82 AC3 — the organiser's own event list, each request with its
 * reference, status and submission date.
 */
export default async function MyEventRequestsPage() {
  const requests = await listMyEventRequests();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">My event requests</h1>
        <Link
          href="/events/new"
          className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)]"
        >
          Create an event request
        </Link>
      </div>

      {requests.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--text-muted)]">
          You have not created any event requests yet.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          {requests.map((request) => (
            <li key={request.id}>
              <Link
                href={`/events/${request.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
              >
                <div>
                  <p className="text-sm font-medium">{request.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">
                    {request.reference}
                  </p>
                </div>
                <div className="text-right">
                  <EventRequestStatusBadge status={request.status} />
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {submissionSummary(request.submittedAt)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
