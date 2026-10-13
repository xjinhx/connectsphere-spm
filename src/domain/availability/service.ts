import { z } from 'zod';
import {
  fetchAffectedBookingSlotsForEvent,
  fetchConfirmedBookingPeriods,
  fetchUnavailablePeriods,
  fetchVenueSetupTurnaround,
  fetchUnavailableSlotsOn,
  fetchUpcomingUnavailableSlots,
  recordUnavailableSlots,
} from '@/lib/supabase/availability';
import { fetchActiveHoldPeriods } from '@/lib/supabase/venueHolds';
import { ConflictError, ValidationError, isUniqueViolation } from '@/domain/shared/errors';
import { formatSingaporeDate, todayInSingapore, type ISODate } from '@/domain/shared/dates';
import { getVenue } from '@/domain/venues/service';
import { notifyBestEffort } from '@/domain/notification/service';
import { OPERATING_SLOTS, OperatingSlotSchema, type OperatingSlot } from '@/domain/venues/schema';
import {
  END_OF_DAY,
  fromDatabaseTime,
  fromMinutes,
  splitDateTime,
  toMinutes,
  type ClockRange,
  type SingaporeDateTime,
} from '@/domain/shared/times';
// SCRUM-225's committed-time rule, which SCRUM-226 applies to every check.
import { committedMinutes, type SetupTurnaround } from '@/domain/venues/policy';
import { affectedBookingMessage, commitmentsInRange, findNonOperatingSlots, toCommittedPeriods } from './policy';
import {
  BookingOnUnavailableSlotSchema,
  MarkSlotsUnavailableInputSchema,
  NoticeWrittenSchema,
  SLOT_NAMES,
  UnavailableSlotSchema,
  VenueCommitmentSchema,
  type BookingOnUnavailableSlot,
  type UnavailableSlot,
  type CommittedPeriod,
  type VenueCommitment,
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
 * view), and its assigned coordinator is notified with the reason: the save
 * stores one notice per booking, and each is then sent as an in-app
 * notification (SCRUM-193).
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
  const { data, error } = await recordUnavailableSlots({
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

  // AC2: the save returns the notices it wrote, and each goes to its
  // coordinator as a notification. Best effort, like SCRUM-198's: a
  // notification that fails is logged and never undoes the save.
  const notices = NoticeWrittenSchema.array().parse(data);
  for (const notice of notices) {
    await notifyBestEffort({
      recipientId: notice.coordinatorId,
      type: 'venue_booking_update',
      eventRequestId: notice.eventRequestId,
      message: affectedBookingMessage(venue.name, notice.date, notice.slots, notice.reason),
    });
  }

  return {
    unavailableSlots: await findUnavailableSlots(venue.id, date, slots),
    notifiedBookings: notices.length,
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
 * SCRUM-231 releases a booking (releaseVenueBooking), which ends its confirmed
 * status, so the entry clears with no change here.
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

  // One entry per venue and date: since SCRUM-148 a booking is one row per
  // slot, and the coordinator sees the event's booking of that venue on that
  // day with each withdrawn slot. bookingId is the first slot's row.
  const byVenueDay = new Map<string, BookingOnUnavailableSlot>();
  for (const row of data.map((raw) => AffectedBookingSlotRowSchema.parse(raw))) {
    const key = `${row.venue_id}|${row.slot_date}`;
    const booking = byVenueDay.get(key) ?? {
      bookingId: row.booking_id,
      venueId: row.venue_id,
      venueName: row.venues.name,
      date: row.slot_date,
      slots: [],
    };
    booking.slots.push({ slot: row.slot, reason: row.reason });
    byVenueDay.set(key, booking);
  }

  return [...byVenueDay.values()]
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

// -----------------------------------------------------------------------------
// SCRUM-239 Check venue availability in 15-minute time ranges
// -----------------------------------------------------------------------------

/**
 * Every committed period at a venue that a booking for [start, end) would
 * clash with: its confirmed bookings, unavailable periods, and active holds
 * (SCRUM-227). The one check behind venue search (SCRUM-239 AC2), booking
 * requests (AC3), approvals (AC4) and the calendar (AC5), and the check
 * SCRUM-227 (holds) and SCRUM-229 (replacement venue) call instead of writing
 * their own. Unavailable periods are included because the story builds on
 * SCRUM-151 and SCRUM-154, which keep a withdrawn period from being booked.
 *
 * SCRUM-226: setup and turnaround are committed, applied here so no caller adds
 * them. Two things widen, both by the venue's setup before and turnaround after
 * (SCRUM-225's committedMinutes):
 *   - each confirmed booking, so 10:00-12:00 with 30 min setup and 45 min
 *     turnaround is returned as 09:30-12:45 (AC4, the calendar shows that);
 *   - the range asked about, because the new booking needs its own setup and
 *     turnaround too (AC5: 13:00 is refused, its setup would start at 12:30
 *     inside the turnaround; 13:15 is free, its setup starts at 12:45).
 * Unavailable periods and holds are returned as recorded: CLAUDE.md lists
 * setup/turnaround as committed "around a booking". A venue with 0 and 0 (the
 * default, PO 8 Oct 2026) behaves exactly as before.
 *
 * So a caller passes the range it wants to book or search and treats any
 * result as a clash. Re-filtering the result against the bare range (e.g. with
 * commitmentsOverlapping) would drop AC5's own-setup clash.
 *
 * `start` and `end` are Singapore date-times on the 15-minute unit. Returned
 * periods are sorted by date, then start time.
 *
 * Each commitment carries the event id or reason behind it, for Venue Staff
 * (SCRUM-239 AC4, as SCRUM-155 AC1; SCRUM-226 AC3 "the clashing booking is
 * identified"). Anything shown to a coordinator or organiser goes through
 * getCommittedPeriods instead, which returns the periods only (SCRUM-226 AC4).
 *
 * A period never crosses midnight: setup and turnaround must fit inside the
 * venue's opening hours (PO assumption, 8 Oct 2026; TC-226-18, 19), and opening
 * hours end by 24:00, so every commitment sits within one date.
 *
 * Only confirmed bookings are read, so a booking SCRUM-231 releases stops
 * committing the venue with no change here.
 *
 * SCRUM-227: a hold commits its period while it is active and `now` is before
 * its expiry (AC3, AC4); once the expiry passes it is simply not returned
 * (AC6), so nothing has to run at the expiry. A hold is never a booking: it
 * comes back as kind 'hold', with its event and its expiry. An event's own
 * holds are still returned; a check made for that event drops them with
 * withoutOwnHolds (src/domain/venue-hold/policy.ts), so the holder can book
 * what it holds (AC5).
 */
export async function getVenueCommitments(
  venueId: string,
  start: SingaporeDateTime,
  end: SingaporeDateTime,
  now: Date = new Date(),
): Promise<VenueCommitment[]> {
  const fromDate = splitDateTime(start).date;
  const toDate = splitDateTime(end).date;
  const [bookings, unavailable, holds, venue] = await Promise.all([
    fetchConfirmedBookingPeriods(venueId, fromDate, toDate),
    fetchUnavailablePeriods(venueId, fromDate, toDate),
    fetchActiveHoldPeriods(venueId, fromDate, toDate, now.toISOString()),
    fetchVenueSetupTurnaround(venueId),
  ]);
  if (
    bookings.error ||
    !bookings.data ||
    unavailable.error ||
    !unavailable.data ||
    holds.error ||
    !holds.data ||
    venue.error
  ) {
    throw new ValidationError(
      "Could not check the venue's availability.",
      bookings.error?.message ?? unavailable.error?.message ?? holds.error?.message ?? venue.error?.message,
    );
  }
  // An unknown venue has no bookings either; 0 and 0 keeps it a no-op.
  const setupTurnaround: SetupTurnaround = {
    setupMinutes: venue.data?.setup_minutes ?? 0,
    turnaroundMinutes: venue.data?.turnaround_minutes ?? 0,
  };

  const commitments: VenueCommitment[] = [
    ...bookings.data.map((row) =>
      VenueCommitmentSchema.parse({
        kind: 'booking',
        venueId: row.venue_id,
        date: row.date,
        // SCRUM-226 AC1-AC4: the booking plus its setup and turnaround.
        ...committedPeriod(
          { start: fromDatabaseTime(row.start_time), end: fromDatabaseTime(row.end_time) },
          setupTurnaround,
        ),
        eventRequestId: row.event_request_id,
        reason: null,
      }),
    ),
    ...unavailable.data.map((row) =>
      VenueCommitmentSchema.parse({
        kind: 'unavailable',
        venueId: row.venue_id,
        date: row.date,
        start: fromDatabaseTime(row.start_time),
        end: fromDatabaseTime(row.end_time),
        eventRequestId: null,
        reason: row.reason,
      }),
    ),
    ...holds.data.map((row) =>
      VenueCommitmentSchema.parse({
        kind: 'hold',
        venueId: row.venue_id,
        date: row.date,
        start: fromDatabaseTime(row.start_time),
        end: fromDatabaseTime(row.end_time),
        eventRequestId: row.event_request_id,
        reason: null,
        expiresAt: new Date(row.expires_at).toISOString(),
      }),
    ),
  ];
  const window = widenedWindow(start, end, setupTurnaround);
  return commitmentsInRange(commitments, window.start, window.end);
}

/**
 * SCRUM-225's committed time as clock times on one date. committedMinutes can
 * run before 00:00 or past 24:00; a commitment stays within its date (opening
 * hours end by 24:00, PO 8 Oct 2026), so the ends are kept inside the day.
 */
function committedPeriod(range: ClockRange, venue: SetupTurnaround): ClockRange {
  const { start, end } = committedMinutes(range, venue);
  return { start: fromMinutes(Math.max(0, start)), end: fromMinutes(Math.min(toMinutes(END_OF_DAY), end)) };
}

/**
 * SCRUM-226 AC5: the range asked about, plus the new booking's own setup
 * before its start and turnaround after its end. Each end is widened on its
 * own date, so a window spanning several days (the calendar) keeps its days.
 */
function widenedWindow(
  start: SingaporeDateTime,
  end: SingaporeDateTime,
  venue: SetupTurnaround,
): { start: SingaporeDateTime; end: SingaporeDateTime } {
  const from = splitDateTime(start);
  const to = splitDateTime(end);
  const widenedStart = committedPeriod({ start: from.time, end: END_OF_DAY }, venue).start;
  // An end of 00:00 closes the window at the start of that day: nothing to widen.
  const widenedEnd = to.time === '00:00' ? to.time : committedPeriod({ start: '00:00', end: to.time }, venue).end;
  return { start: `${from.date}T${widenedStart}`, end: `${to.date}T${widenedEnd}` };
}

/**
 * SCRUM-239 AC3, SCRUM-226 AC4: the venue's committed periods that overlap
 * [start, end), with no other event's details. Use this for anything a
 * coordinator or organiser sees (a refused request, the calendar's committed
 * blocks); use getVenueCommitments only where the viewer may see who holds a
 * period.
 */
export async function getCommittedPeriods(
  venueId: string,
  start: SingaporeDateTime,
  end: SingaporeDateTime,
): Promise<CommittedPeriod[]> {
  return toCommittedPeriods(await getVenueCommitments(venueId, start, end));
}
