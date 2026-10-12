import { fetchPendingRequestLinesBetween, fetchVenueOpeningHours } from '@/lib/supabase/venues';
import { NotFoundError, ValidationError } from '@/domain/shared/errors';
import type { Role } from '@/domain/identity/roles';
import { fromDatabaseTime } from '@/domain/shared/times';
import { getVenueCommitments } from '@/domain/availability/service';
import { listVenueBookings } from '@/domain/venue-booking/service';
import { getVenue } from './service';
import { calendarDay, datesInRange } from './policy';
import { VenueCalendarQuerySchema, VenueCalendarSchema, VenueIdSchema, type VenueCalendar } from './schema';

/**
 * SCRUM-239 AC5 View a venue's calendar in exact time ranges.
 *
 * "Given I view a venue's calendar for a day, when it loads, then confirmed,
 * pending, held and blocked periods each show with their exact start and end
 * times, and no fixed lunch or dinner gap is drawn." Replaces SCRUM-123's
 * AM / PM / Night slots; SCRUM-123 stays Done on slots (Week 7 guide), and its
 * rules carry over in time ranges:
 * - AC1 every date in the range, with the 31-day limit (VenueCalendarQuerySchema)
 * - AC3 the venue's opening hours, outside which it cannot be requested
 * - AC4 fully committed: committed periods cover the whole opening hours
 * - AC5 to AC7 confirmed, pending and blocked periods, a Blocked one with its reason
 * - AC8 a pending request is never a commitment
 * - AC9 and AC10 are the route's and page's permission check
 *
 * Committed periods come from getVenueCommitments, the one availability check
 * agreed on day 1, so holds (SCRUM-227) and setup / turnaround (SCRUM-226)
 * appear here once they join it, with no change to this file.
 *
 * Who sees the event on a Confirmed period stays SCRUM-148's decision: its
 * listVenueBookings() returns the event only for viewers AC3/AC4 allow, and
 * only those events are attached. In its own file, not venues/service.ts,
 * because venue-booking/service.ts already imports venues/service.ts.
 */
export async function getVenueCalendar(
  venueId: string,
  input: unknown,
  actor: { userId: string; roles: readonly Role[] },
): Promise<VenueCalendar> {
  if (!VenueIdSchema.safeParse(venueId).success) {
    throw new NotFoundError('Venue');
  }
  const parsed = VenueCalendarQuerySchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('The calendar could not be loaded.', parsed.error.flatten());
  }
  const { from, to } = parsed.data;

  // Throws NotFoundError for a venue that doesn't exist.
  const venue = await getVenue(venueId);

  const [hours, commitments, booked, pending] = await Promise.all([
    fetchVenueOpeningHours(venueId),
    getVenueCommitments(venueId, `${from}T00:00`, `${to}T24:00`),
    listVenueBookings(venueId, { from, to }, actor),
    fetchPendingRequestLinesBetween(venueId, from, to),
  ]);
  if (hours.error || !hours.data) {
    throw new ValidationError("Could not load the venue's opening hours.", hours.error?.message);
  }
  if (pending.error || !pending.data) {
    throw new ValidationError('Could not load booking requests for that range.', pending.error?.message);
  }

  const opening = { opensAt: fromDatabaseTime(hours.data.opens_at), closesAt: fromDatabaseTime(hours.data.closes_at) };
  const visibleEvents = new Map(
    booked.flatMap((b) => (b.state === 'confirmed' ? [[`${b.date}|${b.event.id}`, b.event] as const] : [])),
  );
  const requested = pending.data.map((line) => ({
    date: line.date,
    start: fromDatabaseTime(line.start_time),
    end: fromDatabaseTime(line.end_time),
  }));

  const days = datesInRange(from, to).map((date) => calendarDay(date, opening, commitments, requested, visibleEvents));

  return VenueCalendarSchema.parse({
    venue: { id: venue.id, name: venue.name, ...opening },
    from,
    to,
    days,
  });
}
