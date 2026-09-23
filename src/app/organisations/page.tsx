import Link from 'next/link';
import { listClientOrganisations } from '@/domain/client-organisation/service';

// Depends on who is signed in (Coordinator-only), so nothing to prerender.
export const dynamic = 'force-dynamic';

/** SCRUM-203 AC1 — the organisations a Coordinator has created so far. */
export default async function ClientOrganisationsPage() {
  const organisations = await listClientOrganisations();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Client organisations</h1>
        <Link
          href="/organisations/new"
          className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)]"
        >
          New organisation
        </Link>
      </div>

      {organisations.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--text-muted)]">No client organisations yet.</p>
      ) : (
        <ul className="mt-6 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          {organisations.map((organisation) => (
            <li key={organisation.id}>
              <Link
                href={`/organisations/${organisation.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
              >
                <p className="text-sm font-medium">{organisation.name}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {organisation.contactEmail ?? 'No contact email on file'}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
