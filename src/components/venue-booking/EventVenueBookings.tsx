import { formatDayMonthYearTime, formatSingaporeDate, formatSingaporeDateTime } from '@/domain/shared/dates';
import type { EventVenueBooking, VenueBookingStatus } from '@/domain/venue-booking/schema';
import { ReleaseVenueBookingForm } from './ReleaseVenueBookingForm';

const STATUS_LABELS: Record<VenueBookingStatus, string> = {
  confirmed: 'Confirmed',
  released: 'Released',
};

/**
 * SCRUM-231 AC1, AC2 — the event's venue bookings on its page, each with its
 * venue, date, times and status, and a released one with its reason. The
 * event's assigned coordinator can release a confirmed one (AC3, decided by
 * listEventVenueBookings). Renders nothing when the event has no bookings.
 *
 * SCRUM-229 AC4: a booking released by an approved replacement shows as
 * Replaced, with its reason ("Replaced by ...").
 *
 * SCRUM-111 AC6: a booking flagged by a significant change shows Review
 * required, with the change that caused it and when.
 *
 * SCRUM-105 AC6: a released booking also says who released it and when, so a
 * release by a cancellation shows the cancelling coordinator and the time.
 */
export function EventVenueBookings({ bookings }: { bookings: EventVenueBooking[] }) {
  if (bookings.length === 0) return null;

  return (
    <section
      aria-labelledby="venue-bookings-heading"
      className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <h2 id="venue-bookings-heading" className="text-sm font-semibold">
        Venue bookings
      </h2>
      <ul className="mt-3 divide-y divide-[var(--border)]">
        {bookings.map((booking) => (
          <li key={booking.id} className="py-3 text-sm first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                {booking.venueName}, {formatSingaporeDate(booking.date)} · {booking.startTime}–{booking.endTime}
              </p>
              <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs font-medium">
                {booking.replaced ? 'Replaced' : STATUS_LABELS[booking.status]}
              </span>
            </div>
            {booking.reviewRequired ? (
              <p className="mt-1 text-[var(--warning)]">
                <span className="font-medium">Review required:</span> {booking.reviewRequiredCause}
                {booking.reviewRequiredAt ? ` (${formatSingaporeDateTime(booking.reviewRequiredAt)})` : ''}
              </p>
            ) : null}
            {booking.releaseReason ? (
              <p className="mt-1 text-[var(--text-muted)]">Reason: {booking.releaseReason}</p>
            ) : null}
            {booking.releasedByName && booking.releasedAt ? (
              <p className="mt-1 text-[var(--text-muted)]">
                Released by {booking.releasedByName} on {formatDayMonthYearTime(booking.releasedAt)}
              </p>
            ) : null}
            {booking.canRelease ? <ReleaseVenueBookingForm bookingId={booking.id} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
