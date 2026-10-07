import { fetchPendingRequestLinesBetween, fetchUnavailableSlotsBetween } from '@/lib/supabase/venues';
import { NotFoundError, ValidationError } from '@/domain/shared/errors';
import type { Role } from '@/domain/identity/roles';
import { listVenueBookings } from '@/domain/venue-booking/service';
import { getVenue } from './service';
import { calendarSlotState, datesInRange, isFullyCommitted } from './policy';
import {
  OPERATING_SLOTS,
  VenueCalendarQuerySchema,
  VenueCalendarSchema,
  VenueIdSchema,
  type CalendarSlot,
  type VenueCalendar,
} from './schema';

/**
 * SCRUM-123 View a venue's calendar with the state of each slot.
 *
 * In its own file, not venues/service.ts, because it reads bookings through
 * SCRUM-148's listVenueBookings() and venue-booking/service.ts already imports
 * venues/service.ts: putting this there would make the two import each other.
 *
 * AC1: every date in the range, each with its AM, PM and Night slot. The range
 *      is checked here first, including the 31-day limit, which
 *      listVenueBookings() doesn't have.
 * AC2–AC3, AC5–AC7: each slot's state, picked by calendarSlotState (policy.ts).
 * AC4: a date where every slot the venue runs is committed is fully committed.
 * AC8: a pending request never adds a commitment; it is counted on its slot.
 * AC9–AC10 are the route's and page's permission check.
 *
 * Sources, all real since SCRUM-148 and SCRUM-151 merged (D-04 and D-09
 * replaced): confirmed bookings and who may see their event from SCRUM-148's
 * listVenueBookings(); unavailable slots recorded through SCRUM-151; pending
 * request lines from SCRUM-142.
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

  const [booked, unavailable, pending] = await Promise.all([
    listVenueBookings(venueId, { from, to }, actor),
    fetchUnavailableSlotsBetween(venueId, from, to),
    fetchPendingRequestLinesBetween(venueId, from, to),
  ]);
  if (unavailable.error || !unavailable.data) {
    throw new ValidationError('Could not load unavailable slots for that range.', unavailable.error?.message);
  }
  if (pending.error || !pending.data) {
    throw new ValidationError('Could not load booking requests for that range.', pending.error?.message);
  }

  const key = (date: string, slot: string) => `${date}|${slot}`;
  // A booked slot is Confirmed either way; listVenueBookings() only decides
  // whether this viewer also sees which event holds it.
  const bookings = new Map(booked.map((b) => [key(b.date, b.slot), b.state === 'confirmed' ? b.event : null]));
  const reasons = new Map(unavailable.data.map((row) => [key(row.date, row.slot), row.reason]));
  const pendingCount = new Map<string, number>();
  for (const line of pending.data) {
    for (const slot of line.time_slots) {
      pendingCount.set(key(line.date, slot), (pendingCount.get(key(line.date, slot)) ?? 0) + 1);
    }
  }

  const operating = new Set<string>(venue.operatingSlots);
  const days = datesInRange(from, to).map((date) => {
    const slots = OPERATING_SLOTS.map((slot): CalendarSlot => {
      const reason = reasons.get(key(date, slot)) ?? null;
      const state = calendarSlotState({
        operates: operating.has(slot),
        unavailableReason: reason,
        confirmed: bookings.has(key(date, slot)),
        pendingRequests: pendingCount.get(key(date, slot)) ?? 0,
      });
      return {
        slot,
        state,
        reason: state === 'blocked' ? reason : null,
        pendingRequests: pendingCount.get(key(date, slot)) ?? 0,
        event: state === 'confirmed' ? (bookings.get(key(date, slot)) ?? null) : null,
      };
    });
    return { date, fullyCommitted: isFullyCommitted(slots.map((s) => s.state)), slots };
  });

  return VenueCalendarSchema.parse({ venue: { id: venue.id, name: venue.name }, from, to, days });
}
