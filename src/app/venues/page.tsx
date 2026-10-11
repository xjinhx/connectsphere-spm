import Link from 'next/link';
import { listVenues } from '@/domain/venues/service';
import { canManageVenues, canViewVenueCatalogue } from '@/domain/venues/policy';
import { getCurrentActor } from '@/lib/auth/currentActor';
import NoVenueAccess from '@/components/venue/NoVenueAccess';

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
 * Needs venue_catalogue_view, checked before any venue is read. The "Add venue"
 * button only appears for roles that can actually use it.
 */

export const dynamic = 'force-dynamic';

export default async function VenueCataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ includeRetired?: string }>;
}) {
  const actor = await getCurrentActor();
  if (!canViewVenueCatalogue(actor.roles)) {
    return <NoVenueAccess need="view" />;
  }

  const { includeRetired } = await searchParams;
  const showRetired = includeRetired === 'true';
  const venues = await listVenues(showRetired);

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Venue catalogue</h1>
        {canManageVenues(actor.roles) && (
          <Link
            href="/venues/new"
            className="rounded bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)]"
          >
            Add venue
          </Link>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-4 text-sm">
        {/* SCRUM-121 AC3: off by default, so the plain URL hides retired venues. */}
        <Link
          href={showRetired ? '/venues' : '/venues?includeRetired=true'}
          className="text-[var(--brand)] underline"
        >
          {showRetired ? 'Hide retired venues' : 'Include retired venues'}
        </Link>
        {/* SCRUM-128 */}
        <Link href="/venues/search" className="text-[var(--brand)] underline">
          Search by date and time
        </Link>
      </div>

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
