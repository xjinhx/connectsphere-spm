import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getVenue, listSetupTurnaroundAffectedBookings } from '@/domain/venues/service';
import { canManageVenues, canViewVenueCatalogue } from '@/domain/venues/policy';
import { listUpcomingUnavailableSlots } from '@/domain/availability/service';
import { SLOT_NAMES } from '@/domain/availability/schema';
import { NotFoundError } from '@/domain/shared/errors';
import { formatSingaporeDate } from '@/domain/shared/dates';
import {
  OPERATING_SLOTS,
  OPERATING_SLOT_LABELS,
  ROOM_LAYOUT_LABELS,
  type VenueDetail,
} from '@/domain/venues/schema';
import { getCurrentActor } from '@/lib/auth/currentActor';
import NoVenueAccess from '@/components/venue/NoVenueAccess';
import { MarkSlotsUnavailableForm } from '@/components/venue/MarkSlotsUnavailableForm';
import { HoldVenueForm } from '@/components/venue/HoldVenueForm';
import { listActiveVenueHolds, listHoldableEvents } from '@/domain/venue-hold/service';
import { formatExpiry } from '@/domain/venue-hold/policy';

/**
 * SCRUM-121 AC2: opening a venue shows its location, capacities, supported
 * layouts, facilities, accessibility features, operating slots and turnaround
 * values.
 *
 * SCRUM-225 AC1 and AC3: the setup and turnaround times, in minutes, shown to
 * every internal user who can open the venue; 0 and 0 until Venue Staff set
 * them on the edit form. They replace SCRUM-119's yes/no slot flags.
 *
 * SCRUM-225 AC5: Venue Staff also see the confirmed bookings a setup or
 * turnaround change flagged as affected, with the event holding each.
 *
 * SCRUM-151 AC1: the venue's upcoming unavailable slots are listed with their
 * reasons, and Venue Staff can mark more from here.
 *
 * SCRUM-227 AC1: Venue Staff see the venue's active holds, each with its event
 * and expiry, and can hold a period for an event from here. A hold that is
 * closed by a booking (AC5) or has passed its expiry (AC6) drops off.
 *
 * Needs venue_catalogue_view, checked before the venue is read. The "Edit
 * venue" button and the unavailable-slots form only appear for Venue Staff.
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

  const unavailableSlots = await listUpcomingUnavailableSlots(venue.id);
  const canManage = canManageVenues(actor.roles);
  const [setupTurnaroundAffected, holds, holdableEvents] = canManage
    ? await Promise.all([
        listSetupTurnaroundAffectedBookings(venue.id),
        listActiveVenueHolds(venue.id),
        listHoldableEvents(),
      ])
    : [[], [], []];

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href="/venues" className="text-sm text-[var(--brand)] underline">
        Back to catalogue
      </Link>

      <div className="mt-3 mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{venue.name}</h1>
        <div className="flex flex-wrap gap-3">
          {/* SCRUM-123: anyone who can view the venue can view its calendar. */}
          <Link
            href={`/venues/${venue.id}/calendar`}
            className="rounded border border-[var(--brand)] px-4 py-2 text-sm font-medium text-[var(--brand)] hover:bg-[var(--surface)]"
          >
            View calendar
          </Link>
          {canManage && (
            <Link
              href={`/venues/${venue.id}/edit`}
              className="rounded bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)]"
            >
              Edit venue
            </Link>
          )}
        </div>
      </div>

      {venue.isRetired && (
        <p className="mb-4 rounded border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--warning)]">
          This venue is retired and is not offered for new events.
        </p>
      )}

      <dl className="rounded border border-[var(--border)] bg-[var(--surface)]">
        <Row label="Location">{venue.location.name}</Row>
        <Row label="Maximum capacity">{venue.maxCapacity}</Row>

        {/* SCRUM-116 AC4: the selected slots apply identically to every day, so all
            three are listed and an unselected slot is shown as not operating
            rather than silently left out (US-11.1-TC05a). */}
        <Row label="Operating slots">
          <p className="mb-1 text-[var(--text-muted)]">Applies to every day of the week.</p>
          <ul>
            {OPERATING_SLOTS.map((slot) => (
              <li key={slot}>
                {OPERATING_SLOT_LABELS[slot]}:{' '}
                {venue.operatingSlots.includes(slot) ? (
                  <span className="text-[var(--success)]">Operating</span>
                ) : (
                  <span className="text-[var(--text-muted)]">Not operating</span>
                )}
              </li>
            ))}
          </ul>
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

        <Row label="Setup time">{venue.setupMinutes} minutes</Row>
        <Row label="Turnaround time">{venue.turnaroundMinutes} minutes</Row>
      </dl>

      {/* SCRUM-225 AC5: bookings a confirmed setup or turnaround change made
          clash. They stay confirmed; the flag says why to look at them. */}
      {canManage && setupTurnaroundAffected.length > 0 && (
        <section className="mt-6 space-y-2 rounded border border-[var(--danger)] bg-[var(--surface)] p-4">
          <h2 className="text-lg font-semibold">Bookings affected by a setup or turnaround change</h2>
          <p className="text-sm text-[var(--text-muted)]">
            These bookings are still confirmed, but no longer leave enough time to set up and reset between them.
          </p>
          <ul className="space-y-1 text-sm">
            {setupTurnaroundAffected.map((booking) => (
              <li key={booking.bookingId}>
                <span className="font-medium">{booking.reference}</span> {booking.eventName},{' '}
                {formatSingaporeDate(booking.date)} {booking.start}-{booking.end} (flagged when setup was set to{' '}
                {booking.setupMinutes} and turnaround to {booking.turnaroundMinutes} minutes)
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* SCRUM-151 AC1: slots withdrawn on specific dates, from today on. */}
      <section className="mt-6 space-y-4 rounded border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-lg font-semibold">Unavailable slots</h2>
        {unavailableSlots.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No slots are unavailable from today on.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {unavailableSlots.map((entry) => (
              <li key={entry.id}>
                {formatSingaporeDate(entry.date)}, {SLOT_NAMES[entry.slot]}: {entry.reason}
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <MarkSlotsUnavailableForm venueId={venue.id} operatingSlots={venue.operatingSlots} />
        )}
      </section>

      {/* SCRUM-227: holds name the event, so only Venue Staff see them here. */}
      {canManage && (
        <section className="mt-6 space-y-4 rounded border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-lg font-semibold">Holds</h2>
          {holds.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No active holds from today on.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {holds.map((hold) => (
                <li key={hold.id}>
                  {formatSingaporeDate(hold.date)}, {hold.start}-{hold.end}: held for{' '}
                  <span className="font-medium">{hold.event.reference}</span> {hold.event.name} until{' '}
                  {formatExpiry(hold.expiresAt)}
                </li>
              ))}
            </ul>
          )}
          <HoldVenueForm venueId={venue.id} events={holdableEvents} />
        </section>
      )}
    </main>
  );
}
