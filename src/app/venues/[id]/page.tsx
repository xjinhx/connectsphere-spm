import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getVenue } from '@/domain/venues/service';
import { canManageVenues, canViewVenueCatalogue } from '@/domain/venues/policy';
import { NotFoundError } from '@/domain/shared/errors';
import { OPERATING_SLOT_LABELS, ROOM_LAYOUT_LABELS, type VenueDetail } from '@/domain/venues/schema';
import { getCurrentActor } from '@/lib/auth/currentActor';
import NoVenueAccess from '@/components/venue/NoVenueAccess';

/**
 * SCRUM-121 AC2: opening a venue shows its location, capacities, supported
 * layouts, facilities, accessibility features, operating slots and turnaround
 * values.
 *
 * The turnaround values are read-only here. Entering them is SCRUM-119, which
 * is deferred out of Sprint 1, so they only ever show what seed data set.
 *
 * Needs venue_catalogue_view, checked before the venue is read. The "Edit
 * venue" button only appears for Venue Staff.
 */

export const dynamic = 'force-dynamic';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-[var(--border)] p-4 last:border-b-0 sm:flex-row sm:gap-6">
      <dt className="w-56 shrink-0 text-sm text-[var(--text-muted)]">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function minutesOrDash(minutes: number | null): string {
  return minutes === null ? 'Not recorded' : `${minutes} minutes`;
}

export default async function VenueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentActor();
  if (!canViewVenueCatalogue(actor.roles)) {
    return <NoVenueAccess need="view" />;
  }

  const { id } = await params;

  let venue: VenueDetail;
  try {
    venue = await getVenue(id);
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href="/venues" className="text-sm text-[var(--brand)] underline">
        Back to catalogue
      </Link>

      <div className="mt-3 mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{venue.name}</h1>
        {canManageVenues(actor.roles) && (
          <Link
            href={`/venues/${venue.id}/edit`}
            className="rounded bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)]"
          >
            Edit venue
          </Link>
        )}
      </div>

      {venue.isRetired && (
        <p className="mb-4 rounded border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--warning)]">
          This venue is retired and is not offered for new events.
        </p>
      )}

      <dl className="rounded border border-[var(--border)] bg-[var(--surface)]">
        <Row label="Location">{venue.location.name}</Row>
        <Row label="Maximum capacity">{venue.maxCapacity}</Row>

        <Row label="Operating slots">
          {venue.operatingSlots.length === 0
            ? 'None'
            : venue.operatingSlots.map((slot) => OPERATING_SLOT_LABELS[slot]).join(', ')}
        </Row>

        <Row label="Supported layouts">
          {venue.layouts.length === 0 ? (
            'None recorded'
          ) : (
            <ul>
              {venue.layouts.map((entry) => (
                <li key={entry.layout}>
                  {ROOM_LAYOUT_LABELS[entry.layout]}: {entry.capacity}
                </li>
              ))}
            </ul>
          )}
        </Row>

        <Row label="Facilities">
          {venue.facilities.length === 0
            ? 'None recorded'
            : venue.facilities.map((facility) => facility.name).join(', ')}
        </Row>

        <Row label="Accessibility features">
          {venue.accessibilityFeatures.length === 0
            ? 'None recorded'
            : venue.accessibilityFeatures.map((feature) => feature.name).join(', ')}
        </Row>

        <Row label="Setup time">{minutesOrDash(venue.setupMinutes)}</Row>
        <Row label="Teardown time">{minutesOrDash(venue.teardownMinutes)}</Row>
        <Row label="Turnaround time">{minutesOrDash(venue.turnaroundMinutes)}</Row>
      </dl>
    </main>
  );
}
