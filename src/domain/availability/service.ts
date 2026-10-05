import { z } from 'zod';
import {
  fetchAffectedBookingSlotsForEvent,
  fetchUnavailableSlotsOn,
  fetchUpcomingUnavailableSlots,
  recordUnavailableSlots,
} from '@/lib/supabase/availability';
import { ConflictError, ValidationError, isUniqueViolation } from '@/domain/shared/errors';
import { formatSingaporeDate, todayInSingapore, type ISODate } from '@/domain/shared/dates';
import { getVenue } from '@/domain/venues/service';
import { OPERATING_SLOTS, OperatingSlotSchema, type OperatingSlot } from '@/domain/venues/schema';
import { findNonOperatingSlots } from './policy';
import {
  BookingOnUnavailableSlotSchema,
  MarkSlotsUnavailableInputSchema,
  SLOT_NAMES,
  UnavailableSlotSchema,
  type BookingOnUnavailableSlot,
  type UnavailableSlot,
} from './schema';

/**
 * Venue availability service (EP-13).
 *
 * SCRUM-151 Withdraw venue availability when circumstances change
 *
 * Orchestration only, like domain/venues/service.ts: every query lives in
 * src/lib/supabase/availability.ts, the rule comparing slots lives in
 * policy.ts, and single-field rules live in schema.ts.
 */

/** A venue_unavailable_slot row, in SCRUM-128's column names (the table is shared). */
type UnavailableSlotRow = {
  id: string;
  venue_id: string;
  date: string;
  slot: string;
  reason: string;
  created_at: string;
};

function toUnavailableSlot(row: UnavailableSlotRow): UnavailableSlot {
  return UnavailableSlotSchema.parse({
    id: row.id,
    venueId: row.venue_id,
    date: row.date,
    slot: row.slot,
    reason: row.reason,
    recordedAt: row.created_at,
  });
}

/** Soonest date first, and within a day AM, PM, Night: the order the day runs in. */
function byDateThenSlot(a: UnavailableSlot, b: UnavailableSlot): number {
  return a.date.localeCompare(b.date) || OPERATING_SLOTS.indexOf(a.slot) - OPERATING_SLOTS.indexOf(b.slot);
}

/** "AM", "AM and PM", "AM, PM and Night". */
function slotNames(slots: readonly OperatingSlot[]): string {
  const names = slots.map((slot) => SLOT_NAMES[slot]);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// -----------------------------------------------------------------------------
// SCRUM-151 AC1 and AC2: record slots as unavailable, and tell the
// coordinators whose confirmed bookings are on them
// -----------------------------------------------------------------------------

export type MarkSlotsUnavailableOutcome = {
  /** AC1: the slots now recorded as unavailable. */
  unavailableSlots: UnavailableSlot[];
  /** AC2: affected bookings of upcoming events whose coordinator was notified. */
  notifiedBookings: number;
};

/**
 * SCRUM-151 AC1: record the chosen slots of one venue on one date as
 * unavailable, each with the reason and who recorded it.
 *
 * SCRUM-151 AC2: in the same save, every confirmed booking of an upcoming
 * event on one of those slots becomes affected (the affected_booking_slot
 * view), and its assigned coordinator is sent a notice with the reason.
 * DUMMY(SCRUM-193) D-11: the notice is stored, not shown, until the in-app
 * notification list exists.
 *
 * All or nothing: one database function writes the slots and the notices in
 * one transaction, so if one slot is already unavailable nothing is saved and
 * nobody is told, and the message names the slots that were.
 *
 * Who may do this is checked by the route: venue_administration, which is
 * Venue Staff's in SCRUM-69's matrix (customer clarification #54 makes
 * availability their job, and an availability change affecting an upcoming
 * event "a notification scenario"). The recorder is the signed-in account
 * passed in by the route, never an id from the request body.
 */
export async function markSlotsUnavailable(
  venueId: string,
  input: unknown,
  actorId: string,
): Promise<MarkSlotsUnavailableOutcome> {
  const parsed = MarkSlotsUnavailableInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? 'The slots could not be marked unavailable.',
      parsed.error.flatten(),
    );
  }
  const { date, slots, reason } = parsed.data;

  // Throws NotFoundError for a venue that does not exist or a malformed id.
  const venue = await getVenue(venueId);

  const notOperating = findNonOperatingSlots(slots, venue.operatingSlots);
  if (notOperating.length > 0) {
    throw new ValidationError(
      `${venue.name} does not operate in the ${slotNames(notOperating)} slot${notOperating.length > 1 ? 's' : ''}, so there is nothing to withdraw.`,
      { notOperating },
    );
  }

  // "Upcoming" is judged on Singapore's date, decided here and handed to the
  // save, not on the database's UTC clock.
  const { data: notifiedBookings, error } = await recordUnavailableSlots({
    venueId: venue.id,
    date,
    slots: [...slots],
    reason,
    recordedBy: actorId,
    today: todayInSingapore(),
  });

  if (error) {
    if (isUniqueViolation(error)) {
      throw await alreadyUnavailableError(venue.id, date, slots);
    }
    throw new ValidationError('The slots could not be marked unavailable.', error.message);
  }

  return {
    unavailableSlots: await findUnavailableSlots(venue.id, date, slots),
    notifiedBookings: notifiedBookings ?? 0,
  };
}

/** The 409 for a save that included a slot already unavailable. It names which. */
async function alreadyUnavailableError(
  venueId: string,
  date: ISODate,
  slots: readonly OperatingSlot[],
): Promise<ConflictError> {
  const existing = await findUnavailableSlots(venueId, date, slots);
  const names = slotNames(existing.map((entry) => entry.slot));
  const message =
    existing.length === 0
      ? 'One of those slots is already unavailable. Nothing was saved.'
      : `${names} on ${formatSingaporeDate(date)} ${existing.length === 1 ? 'is' : 'are'} already unavailable. Nothing was saved.`;
  return new ConflictError(message, { reason: 'already_unavailable', alreadyUnavailable: existing });
}

// -----------------------------------------------------------------------------
// SCRUM-151 AC1: "no longer offered for new bookings"
// -----------------------------------------------------------------------------

/**
 * The one place that answers "is this slot unavailable, and why?". Returns
 * the slots among `slots` (all three if left out) that are unavailable at the
 * venue on `date`, each with its recorded reason. An empty list means none of
 * them has been withdrawn.
 *
 * For the stories that offer or accept slots, so the rule lives in one place:
 * SCRUM-154 AC4-5 (refuse a booking request), SCRUM-155 AC5 (refuse an
 * approval and show the reason), SCRUM-128 AC4 (leave the venue out of a
 * search) and SCRUM-123 AC7 (show the slot as Blocked with its reason).
 * Tested directly for now; re-tested end to end once those stories call it.
 */
export async function findUnavailableSlots(
  venueId: string,
  date: ISODate,
  slots: readonly OperatingSlot[] = OPERATING_SLOTS,
): Promise<UnavailableSlot[]> {
  const { data, error } = await fetchUnavailableSlotsOn(venueId, date, slots);
  if (error || !data) {
    throw new ValidationError("Could not check the venue's availability.", error?.message);
  }
  return data.map(toUnavailableSlot).sort(byDateThenSlot);
}

// -----------------------------------------------------------------------------
// SCRUM-151 AC3: the coordinator's outstanding action
// -----------------------------------------------------------------------------

/**
 * One row of the affected_booking_slot view. A view's columns all come back
 * as nullable in the generated types, so each row is checked here rather than
 * cast into shape.
 */
const AffectedBookingSlotRowSchema = z.object({
  booking_id: z.string().uuid(),
  venue_id: z.string().uuid(),
  slot_date: z.string(),
  slot: OperatingSlotSchema,
  reason: z.string(),
  venues: z.object({ name: z.string() }),
});

/**
 * SCRUM-151 AC3: the event's affected bookings, each with its venue, date and
 * withdrawn slots with their reasons, for the coordinator's event page to list
 * as an outstanding action.
 *
 * Read from the affected_booking_slot view (AC2's flag), so a booking is
 * listed for as long as it is still confirmed on an unavailable slot and drops
 * off once it is released, which is also what replacing it ends with (book
 * another venue or slot, then release this one): "until they release or
 * replace it". Upcoming events only, on the Singapore date, like AC2's notices.
 *
 * DUMMY(SCRUM-17) D-12: nothing in the app releases a single booking yet, and
 * no story in the backlog does (a new one is being raised). Testers remove the
 * booking by hand to see the entry clear.
 *
 * No access check of its own: its only caller is the coordinator's review
 * page, which calls it after getReviewDetail has refused anyone the request is
 * not theirs to see (SCRUM-89 AC3). An API route exposing it would need one.
 */
export async function listAffectedBookings(
  eventRequestId: string,
  today: ISODate = todayInSingapore(),
): Promise<BookingOnUnavailableSlot[]> {
  const { data, error } = await fetchAffectedBookingSlotsForEvent(eventRequestId, today);
  if (error || !data) {
    throw new ValidationError("Could not check the event's venue bookings.", error?.message);
  }

  const byBooking = new Map<string, BookingOnUnavailableSlot>();
  for (const row of data.map((raw) => AffectedBookingSlotRowSchema.parse(raw))) {
    const booking = byBooking.get(row.booking_id) ?? {
      bookingId: row.booking_id,
      venueId: row.venue_id,
      venueName: row.venues.name,
      date: row.slot_date,
      slots: [],
    };
    booking.slots.push({ slot: row.slot, reason: row.reason });
    byBooking.set(row.booking_id, booking);
  }

  return [...byBooking.values()]
    .map((booking) =>
      BookingOnUnavailableSlotSchema.parse({
        ...booking,
        slots: [...booking.slots].sort((a, b) => OPERATING_SLOTS.indexOf(a.slot) - OPERATING_SLOTS.indexOf(b.slot)),
      }),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.venueName.localeCompare(b.venueName));
}

/**
 * The venue page's list: this venue's unavailable slots from today on,
 * soonest first. "Today" is Singapore's date, not the server's UTC one.
 */
export async function listUpcomingUnavailableSlots(
  venueId: string,
  today: ISODate = todayInSingapore(),
): Promise<UnavailableSlot[]> {
  const { data, error } = await fetchUpcomingUnavailableSlots(venueId, today);
  if (error || !data) {
    throw new ValidationError("Could not load the venue's unavailable slots.", error?.message);
  }
  return data.map(toUnavailableSlot).sort(byDateThenSlot);
}
