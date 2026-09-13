import Link from 'next/link';
import { EventRequestStatusBadge } from '@/components/event-request/EventRequestStatusBadge';
import { getClientOrganisation } from '@/domain/client-organisation/service';
import { formatSingaporeDate } from '@/domain/shared/dates';

export const dynamic = 'force-dynamic';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-[var(--border)] py-3 last:border-b-0">
      <dt className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">{label}</dt>
      <dd className="mt-1 text-sm">{value}</dd>
    </div>
  );
}

/** SCRUM-203 AC3 — an organisation with the events recorded against it. */
export default async function ClientOrganisationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const organisation = await getClientOrganisation(id);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/organisations" className="text-sm text-[var(--brand)] hover:underline">
        ← Client organisations
      </Link>

      <h1 className="mt-4 text-xl font-semibold">{organisation.name}</h1>

      <dl className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4">
        <Row label="Contact name" value={organisation.contactName ?? 'Not provided'} />
        <Row label="Contact email" value={organisation.contactEmail ?? 'Not provided'} />
        <Row label="Contact phone" value={organisation.contactPhone ?? 'Not provided'} />
      </dl>

      <h2 className="mt-8 text-sm font-medium tracking-wide text-[var(--text-muted)] uppercase">
        Events recorded against this organisation
      </h2>

      {organisation.events.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">No events recorded yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          {organisation.events.map((event) => (
            <li key={event.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-sm font-medium">{event.name}</p>
                <p className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">{event.reference}</p>
              </div>
              <div className="text-right">
                <EventRequestStatusBadge status={event.status} />
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {event.proposedDate ? formatSingaporeDate(event.proposedDate) : 'No date proposed yet'}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
