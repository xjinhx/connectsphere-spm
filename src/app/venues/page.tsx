import Link from 'next/link';
import { listVenues } from '@/domain/venues/service';

/**
 * SCRUM-121 Browse the venue catalogue.
 *
 * AC1 every venue is listed with its name, location and maximum capacity.
 * AC3 the default view shows active venues only; retired venues appear only
 *     when they are explicitly asked for.
 *
 * A server component reading through the domain service. The API routes exist
 * for the browser to write through, not for the app to call itself over HTTP.
 *
 * TODO(SCRUM-69): gate on canViewVenueCatalogue(currentUserRoles) once sign-in
 * exists. There is no current-user helper yet.
 */

export const dynamic = 'force-dynamic';

export default async function VenueCataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ includeRetired?: string }>;
}) {
  const { includeRetired } = await searchParams;
  const showRetired = includeRetired === 'true';
  const venues = await listVenues(showRetired);

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Venue catalogue</h1>
        <Link
          href="/venues/new"
          className="rounded bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)]"
        >
          Add venue
        </Link>
      </div>

      {/* SCRUM-121 AC3: off by default, so the plain URL hides retired venues. */}
      <Link
        href={showRetired ? '/venues' : '/venues?includeRetired=true'}
        className="mb-4 inline-block text-sm text-[var(--brand)] underline"
      >
        {showRetired ? 'Hide retired venues' : 'Include retired venues'}
      </Link>

      {venues.length === 0 ? (
        <p className="rounded border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--text-muted)]">
          No venues in the catalogue yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                <th scope="col" className="p-3 font-medium">
                  Name
                </th>
                <th scope="col" className="p-3 font-medium">
                  Location
                </th>
                <th scope="col" className="p-3 font-medium">
                  Maximum capacity
                </th>
                <th scope="col" className="p-3 font-medium">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {venues.map((venue) => (
                <tr key={venue.id} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="p-3">
                    <Link href={`/venues/${venue.id}`} className="text-[var(--brand)] underline">
                      {venue.name}
                    </Link>
                  </td>
                  <td className="p-3">{venue.location.name}</td>
                  <td className="p-3">{venue.maxCapacity}</td>
                  <td className="p-3">
                    {venue.isRetired ? (
                      <span className="text-[var(--warning)]">Retired</span>
                    ) : (
                      <span className="text-[var(--success)]">Active</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-sm text-[var(--text-muted)]">
        {venues.length} {venues.length === 1 ? 'venue' : 'venues'} shown.
      </p>
    </main>
  );
}
