import { formatSingaporeDate } from '@/domain/shared/dates';
import { SLOT_NAMES, type BookingOnUnavailableSlot } from '@/domain/availability/schema';

/**
 * SCRUM-151 AC3: on the coordinator's event page, each affected booking is
 * listed with an outstanding action (CONTEXT.md) until the booking is released
 * or replaced. Renders nothing when no booking is affected.
 *
 * DUMMY(SCRUM-231) D-12: nothing in the app releases a single booking yet, so
 * the action is stated rather than offered as a button.
 */
export function AffectedBookingsNotice({ bookings }: { bookings: BookingOnUnavailableSlot[] }) {
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
              {booking.venueName}, {formatSingaporeDate(booking.date)}
            </p>
            <ul className="mt-1 list-disc pl-5">
              {booking.slots.map((entry) => (
                <li key={entry.slot}>
                  {SLOT_NAMES[entry.slot]} is unavailable: {entry.reason}
                </li>
              ))}
            </ul>
            <p className="mt-1">Action needed: release or replace this booking.</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
