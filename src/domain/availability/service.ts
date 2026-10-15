import { z } from 'zod';
import {
  fetchAffectedBookingsForEvent,
  fetchConfirmedBookingPeriods,
  fetchUnavailablePeriods,
  fetchUnavailablePeriodsOn,
  fetchUpcomingUnavailablePeriods,
  recordUnavailablePeriod,
} from '@/lib/supabase/availability';
import { fetchActiveHoldPeriods } from '@/lib/supabase/venueHolds';
import { ConflictError, ValidationError, isExclusionViolation } from '@/domain/shared/errors';
import { formatSingaporeDate, todayInSingapore, type ISODate } from '@/domain/shared/dates';
import { getVenue } from '@/domain/venues/service';
import { isWithinOpeningHours } from '@/domain/venues/policy';
import { notifyBestEffort } from '@/domain/notification/service';
import {
  formatClockRange,
  fromDatabaseTime,
  rangesOverlap,
  splitDateTime,
  type ClockRange,
  type SingaporeDateTime,
} from '@/domain/shared/times';
import { affectedBookingMessage, commitmentsInRange, toCommittedPeriods } from './policy';
import {
  BookingOnUnavailablePeriodSchema,
  MarkPeriodUnavailableInputSchema,
  NoticeWrittenSchema,
  UnavailablePeriodSchema,
  VenueCommitmentSchema,
  type BookingOnUnavailablePeriod,
  type UnavailablePeriod,
  type CommittedPeriod,
  type VenueCommitment,
} from './schema';

/**
 * Venue availability service (EP-13).
 *
 * SCRUM-151 Withdraw venue availability when circumstances change, in time
 * ranges since SCRUM-239 AC6.
 *
 * Orchestration only, like domain/venues/service.ts: every query lives in
 * src/lib/supabase/availability.ts, the rules live in policy.ts, and
 * single-field rules live in schema.ts.
 */

/** A venue_unavailable_slot row, read as a period. */
type UnavailablePeriodRow = {
  id: string;
  venue_id: string;
  date: string;
  start_time: string;
  end_time: string;
  reason: string;
  created_at: string;
};

function toUnavailablePeriod(row: UnavailablePeriodRow): UnavailablePeriod {
  return UnavailablePeriodSchema.parse({
    id: row.id,
    venueId: row.venue_id,
    date: row.date,
    start: fromDatabaseTime(row.start_time),
    end: fromDatabaseTime(row.end_time),
    reason: row.reason,
    recordedAt: row.created_at,
  });
}

/** Soonest date first, then by start time: the order the days run in. */
function byDateThenStart(a: { date: string; start: string }, b: { date: string; start: string }): number {
  return a.date.localeCompare(b.date) || a.start.localeCompare(b.start);
}

// -----------------------------------------------------------------------------
// SCRUM-239 AC6 (SCRUM-151 AC1 and AC2 in times): record a period as
// unavailable, and tell the coordinators whose confirmed bookings overlap it
// -----------------------------------------------------------------------------

export type MarkPeriodUnavailableOutcome = {
  /** AC1: the venue's unavailable periods on that date, the new one included. */
  unavailablePeriods: UnavailablePeriod[];
  /** AC2: affected bookings' events whose coordinator was notified. */
  notifiedBookings: number;
};

/**
 * SCRUM-239 AC6: "Given Venue Staff mark a venue unavailable from 14:00 to
 * 16:30, when they save, then only bookings overlapping that period are
 * flagged — SCRUM-151's behaviour applied to time ranges."
 *
 * SCRUM-151 AC1: the period is recorded with the reason and who recorded it.
 * SCRUM-151 AC2: in the same save, every confirmed booking of an upcoming
 * event whose times overlap the period becomes affected (the
 * affected_booking_slot view, matched by time), and its assigned coordinator
 * is notified with the reason. Half-open: a booking ending at 14:00 or
 * starting at 16:30 only touches the period and is not flagged.
 *
 * All or nothing: one database function writes the period and the notices in
 * one transaction. A period overlapping one already recorded is refused, and
 * the message names the one it overlaps; nothing is saved and nobody is told.
 *
 * A period outside the venue's opening hours is refused, the way SCRUM-151
 * refused a slot the venue did not operate: the venue is never offered then,
 * so there is nothing to withdraw.
 *
 * Who may do this is checked by the route: venue_administration (Venue Staff,
 * SCRUM-69). The recorder is the signed-in account passed in by the route.
 */
export async function markPeriodUnavailable(
  venueId: string,
  input: unknown,
  actorId: string,
): Promise<MarkPeriodUnavailableOutcome> {
  const parsed = MarkPeriodUnavailableInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? 'The period could not be marked unavailable.',
      parsed.error.flatten(),
    );
  }
  const { date, start, end, reason } = parsed.data;

  // Throws NotFoundError for a venue that does not exist or a malformed id.
  const venue = await getVenue(venueId);

  if (!isWithinOpeningHours({ start, end }, venue)) {
    throw new ValidationError(
      `${venue.name} is open ${formatClockRange({ start: venue.opensAt, end: venue.closesAt })}, so there is nothing to withdraw outside those hours.`,
      { fieldErrors: { start: ['Outside the venue\'s opening hours.'], end: ['Outside the venue\'s opening hours.'] } },
    );
  }

  // "Upcoming" is judged on Singapore's date, decided here and handed to the
  // save, not on the database's UTC clock.
  const { data, error } = await recordUnavailablePeriod({
    venueId: venue.id,
    date,
    start,
    end,
    reason,
    recordedBy: actorId,
    today: todayInSingapore(),
  });

  if (error) {
    if (isExclusionViolation(error)) {
      throw await alreadyUnavailableError(venue.id, date, { start, end });
    }
    throw new ValidationError('The period could not be marked unavailable.', error.message);
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
      message: affectedBookingMessage(venue.name, notice.date, notice, notice.reason),
    });
  }

  return {
    unavailablePeriods: await findUnavailablePeriods(venue.id, date),
    notifiedBookings: notices.length,
  };
}

/** The 409 for a period that overlaps one already recorded. It names which. */
async function alreadyUnavailableError(venueId: string, date: ISODate, period: ClockRange): Promise<ConflictError> {
  const overlapping = await findUnavailablePeriods(venueId, date, period);
  const named = overlapping.map((entry) => formatClockRange(entry)).join(', ');
  const message =
    overlapping.length === 0
      ? 'Part of that period is already unavailable. Nothing was saved.'
      : `${formatSingaporeDate(date)} ${named} ${overlapping.length === 1 ? 'is' : 'are'} already unavailable. Nothing was saved.`;
  return new ConflictError(message, { reason: 'already_unavailable', alreadyUnavailable: overlapping });
}

/**
 * The venue's unavailable periods on `date`, each with its recorded reason,
 * in start-time order. With `range`, only those overlapping it.
 */
export async function findUnavailablePeriods(venueId: string, date: ISODate, range?: ClockRange): Promise<UnavailablePeriod[]> {
  const { data, error } = await fetchUnavailablePeriodsOn(venueId, date);
  if (error || !data) {
    throw new ValidationError("Could not check the venue's availability.", error?.message);
  }
  return data
    .map(toUnavailablePeriod)
    .filter((entry) => range === undefined || rangesOverlap(entry, range))
    .sort(byDateThenStart);
}

// -----------------------------------------------------------------------------
// SCRUM-151 AC3, by time: the coordinator's outstanding action
// -----------------------------------------------------------------------------

/**
 * One row of the affected_booking_slot view. A view's columns all come back
 * as nullable in the generated types, so each row is checked here rather than
 * cast into shape.
 */
const AffectedBookingRowSchema = z.object({
  booking_id: z.string().uuid(),
  venue_id: z.string().uuid(),
  slot_date: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  unavailable_start_time: z.string(),
  unavailable_end_time: z.string(),
  reason: z.string(),
  venues: z.object({ name: z.string() }),
});

/**
 * SCRUM-151 AC3: the event's affected bookings, each with its venue, date and
 * times and the unavailable periods overlapping it with their reasons, for the
 * coordinator's event page to list as an outstanding action.
 *
 * Read from the affected_booking_slot view (AC2's flag, matched by time since
 * SCRUM-239 AC6), so a booking is listed for as long as it is still confirmed
 * and overlaps an unavailable period, and drops off once it is released
 * (SCRUM-231, releaseVenueBooking), which is also what replacing it ends with:
 * "until they release or replace it". Upcoming events only, on the Singapore
 * date, like AC2's notices.
 *
 * No access check of its own: its only caller is the coordinator's review
 * page, which calls it after getReviewDetail has refused anyone the request is
 * not theirs to see (SCRUM-89 AC3). An API route exposing it would need one.
 */
export async function listAffectedBookings(
  eventRequestId: string,
  today: ISODate = todayInSingapore(),
): Promise<BookingOnUnavailablePeriod[]> {
  const { data, error } = await fetchAffectedBookingsForEvent(eventRequestId, today);
  if (error || !data) {
    throw new ValidationError("Could not check the event's venue bookings.", error?.message);
  }

  // One entry per booking, with every unavailable period overlapping it.
  const byBooking = new Map<string, BookingOnUnavailablePeriod>();
  for (const row of data.map((raw) => AffectedBookingRowSchema.parse(raw))) {
    const booking = byBooking.get(row.booking_id) ?? {
      bookingId: row.booking_id,
      venueId: row.venue_id,
      venueName: row.venues.name,
      date: row.slot_date,
      start: fromDatabaseTime(row.start_time),
      end: fromDatabaseTime(row.end_time),
      unavailable: [],
    };
    booking.unavailable.push({
      start: fromDatabaseTime(row.unavailable_start_time),
      end: fromDatabaseTime(row.unavailable_end_time),
      reason: row.reason,
    });
    byBooking.set(row.booking_id, booking);
  }

  return [...byBooking.values()]
    .map((booking) =>
      BookingOnUnavailablePeriodSchema.parse({
        ...booking,
        unavailable: [...booking.unavailable].sort((a, b) => a.start.localeCompare(b.start)),
      }),
    )
    .sort((a, b) => byDateThenStart(a, b) || a.venueName.localeCompare(b.venueName));
}

/**
 * The venue page's list: this venue's unavailable periods from today on,
 * soonest first. "Today" is Singapore's date, not the server's UTC one.
 */
export async function listUpcomingUnavailablePeriods(
  venueId: string,
  today: ISODate = todayInSingapore(),
): Promise<UnavailablePeriod[]> {
  const { data, error } = await fetchUpcomingUnavailablePeriods(venueId, today);
  if (error || !data) {
    throw new ValidationError("Could not load the venue's unavailable periods.", error?.message);
  }
  return data.map(toUnavailablePeriod).sort(byDateThenStart);
}

// -----------------------------------------------------------------------------
// SCRUM-239 Check venue availability in 15-minute time ranges
// -----------------------------------------------------------------------------

/**
 * Every committed period at a venue that overlaps [start, end): its confirmed
 * bookings, unavailable periods, and active holds (SCRUM-227).
 * The one check behind venue search (SCRUM-239 AC2), booking requests (AC3),
 * approvals (AC4) and the calendar (AC5), and the check SCRUM-227 (holds) and
 * SCRUM-229 (replacement venue) call instead of writing their own. Unavailable
 * periods are included because the story builds on SCRUM-151 and SCRUM-154,
 * which keep a withdrawn period from being booked. SCRUM-226 will widen each
 * period by the venue's setup and turnaround here, so no caller adds them.
 *
 * `start` and `end` are Singapore date-times on the 15-minute unit. Returned
 * periods are sorted by date, then start time.
 *
 * Each commitment carries the event id or reason behind it, for Venue Staff
 * (SCRUM-239 AC4, as SCRUM-155 AC1). Anything shown to a coordinator or
 * organiser goes through getCommittedPeriods instead, which returns the
 * periods only.
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
  const [bookings, unavailable, holds] = await Promise.all([
    fetchConfirmedBookingPeriods(venueId, fromDate, toDate),
    fetchUnavailablePeriods(venueId, fromDate, toDate),
    fetchActiveHoldPeriods(venueId, fromDate, toDate, now.toISOString()),
  ]);
  if (bookings.error || !bookings.data || unavailable.error || !unavailable.data || holds.error || !holds.data) {
    throw new ValidationError(
      "Could not check the venue's availability.",
      bookings.error?.message ?? unavailable.error?.message ?? holds.error?.message,
    );
  }

  const commitments: VenueCommitment[] = [
    ...bookings.data.map((row) =>
      VenueCommitmentSchema.parse({
        kind: 'booking',
        venueId: row.venue_id,
        date: row.date,
        start: fromDatabaseTime(row.start_time),
        end: fromDatabaseTime(row.end_time),
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
  return commitmentsInRange(commitments, start, end);
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
