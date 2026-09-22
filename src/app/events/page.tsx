import Link from 'next/link';
import { EventRequestStatusBadge } from '@/components/event-request/EventRequestStatusBadge';
import { submissionSummary } from '@/domain/event-request/policy';
import { listMyEventRequests } from '@/domain/event-request/service';
import { getCurrentActor } from '@/lib/auth/currentActor';

// Depends on who is signed in, so there is nothing to prerender at build time.
export const dynamic = 'force-dynamic';

/**
 * SCRUM-82 AC3 — the organiser's own event list, each request with its
 * reference, status and submission date.
 *
 * SCRUM-204 AC2 — an organiser not yet linked to a client organisation sees
 * no events at all, with an explicit message rather than an empty-looking
 * list, since there is no organisation for the access rules to resolve
 * against yet.
 *
 * SCRUM-204 AC3 — once linked, the list widens to the whole organisation:
 * every request a colleague there has submitted appears too, view-only,
 * alongside the organiser's own (including their own still-private drafts).
 */
export default async function MyEventRequestsPage() {
  const actor = await getCurrentActor();
  const requests = actor.clientOrganisation ? await listMyEventRequests() : [];

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">
          {actor.clientOrganisation ? `${actor.clientOrganisation.name}'s event requests` : 'My event requests'}
        </h1>
        {actor.clientOrganisation && (
          <Link
            href="/events/new"
            className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)]"
          >
            Create an event request
          </Link>
        )}
      </div>

      {!actor.clientOrganisation ? (
        <p className="mt-6 text-sm text-[var(--text-muted)]">
          Your account is not yet linked to a client organisation. Contact your
          Event Coordinator to get linked before creating or viewing event
          requests.
        </p>
      ) : requests.length === 0 ? (
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
                  {/* SCRUM-204 AC3 — a colleague's request is here view-only;
                      "Yours" is the only visible cue for which is which. */}
                  {request.organiserId !== actor.userId && (
                    <p className="mt-1 text-xs text-[var(--text-muted)]">View-only</p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
