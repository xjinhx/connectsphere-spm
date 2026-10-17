import { formatSingaporeDate } from '@/domain/shared/dates';
import type { BookingOnUnavailablePeriod } from '@/domain/availability/schema';
import { formatClockRange } from '@/domain/shared/times';
import { ReplaceBookingAction } from '@/components/venue-booking/ReplaceBookingAction';
import type { EventRequirements, VenueOption } from '@/components/event-request/RequestVenueBookingForm';

/**
 * SCRUM-229 AC1: what the notice needs to offer a replacement. Only the
 * bookings in `bookingIds` are offered one: those the viewer may release
 * (SCRUM-231 AC3), while the event allows a replacement request.
 */
export interface ReplacementOptions {
  eventId: string;
  bookingIds: readonly string[];
  venues: readonly VenueOption[];
  eventRequirements: EventRequirements;
}

/**
 * SCRUM-151 AC3: on the coordinator's event page, each affected booking is
 * listed with an outstanding action (CONTEXT.md) until the booking is released
 * or replaced. Renders nothing when no booking is affected. Since SCRUM-239
 * AC6 a booking is affected when its times overlap an unavailable period, and
 * both are shown in times.
 *
 * SCRUM-231 releases the booking from the event's Venue bookings list, further
 * down the page, and that closes this entry (AC4). The action points there
 * rather than repeating the button.
 *
 * SCRUM-229 AC1: each entry also offers a replacement request, which closes
 * the entry once it is approved (AC4).
 */
export function AffectedBookingsNotice({
  bookings,
  replacement,
}: {
  bookings: BookingOnUnavailablePeriod[];
  replacement?: ReplacementOptions;
}) {
  if (bookings.length === 0) return null;

  return (
    <section
      aria-labelledby="affected-bookings-heading"
      className="mt-4 rounded-md border border-[var(--danger)] bg-red-50 px-3 py-2 text-sm"
    >
      <h2 id="affected-bookings-heading" className="font-medium text-[var(--danger)]">
        Outstanding action: a venue booking is affected
      </h2>
      <ul className="mt-2 space-y-3">
        {bookings.map((booking) => (
          <li key={booking.bookingId}>
            <p className="font-medium">
              {booking.venueName}, {formatSingaporeDate(booking.date)} · {formatClockRange(booking)}
            </p>
            <ul className="mt-1 list-disc pl-5">
              {booking.unavailable.map((entry) => (
                <li key={entry.start}>
                  {formatClockRange(entry)} is unavailable: {entry.reason}
                </li>
              ))}
            </ul>
            <p className="mt-1">
              Action needed: release this booking under Venue bookings, or request a replacement venue.
            </p>
            {replacement?.bookingIds.includes(booking.bookingId) ? (
              <ReplaceBookingAction
                eventId={replacement.eventId}
                bookingId={booking.bookingId}
                period={{ date: booking.date, start: booking.start, end: booking.end }}
                // AC1: "another venue", so not the one that is unavailable.
                venues={replacement.venues.filter((venue) => venue.id !== booking.venueId)}
                eventRequirements={replacement.eventRequirements}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
