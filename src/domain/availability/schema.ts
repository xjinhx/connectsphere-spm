import { z } from 'zod';
import { isISODate } from '@/domain/shared/dates';
import { ClockRangeSchema, EndTimeSchema, StartTimeSchema } from '@/domain/shared/times';

/**
 * Venue availability (EP-13): data shapes shared by the API route and the UI.
 *
 * SCRUM-151 Withdraw venue availability when circumstances change, in time
 * ranges since SCRUM-239 AC6.
 *
 * An unavailable slot (CONTEXT.md) is a period at one venue on one date that
 * Venue Staff have withdrawn from use, with the reason recorded. Since
 * SCRUM-239 AC6 it is a start and end time on the 15-minute unit rather than
 * an AM / PM / Night slot; the table keeps its name, venue_unavailable_slot.
 */

/**
 * SCRUM-239 AC6, SCRUM-151 AC1: "Given Venue Staff mark a venue unavailable
 * from 14:00 to 16:30". A date, a start and end time checked by the shared
 * ClockRangeSchema, and the reason. The venue comes from the URL.
 */
export const MarkPeriodUnavailableInputSchema = z
  .object({
    date: z.string({ required_error: 'Choose a date.' }).refine(isISODate, 'Choose a valid date.'),
    reason: z.string({ required_error: 'A reason is required.' }).trim().min(1, 'A reason is required.'),
  })
  .and(ClockRangeSchema);
export type MarkPeriodUnavailableInput = z.infer<typeof MarkPeriodUnavailableInputSchema>;

/**
 * SCRUM-151 AC3, by time (SCRUM-239 AC6): an affected booking (CONTEXT.md) as
 * the coordinator's event page lists it: the booking's venue, date and times,
 * and each unavailable period that overlaps it, with its reason.
 */
export const BookingOnUnavailablePeriodSchema = z.object({
  bookingId: z.string().uuid(),
  venueId: z.string().uuid(),
  venueName: z.string(),
  date: z.string(),
  start: z.string(),
  end: z.string(),
  unavailable: z.array(z.object({ start: z.string(), end: z.string(), reason: z.string() })).min(1),
});
export type BookingOnUnavailablePeriod = z.infer<typeof BookingOnUnavailablePeriodSchema>;

/** One recorded unavailable period, as the API and the venue page show it. */
export const UnavailablePeriodSchema = z.object({
  id: z.string().uuid(),
  venueId: z.string().uuid(),
  date: z.string(),
  start: z.string(),
  end: z.string(),
  reason: z.string(),
  recordedAt: z.string(),
});
export type UnavailablePeriod = z.infer<typeof UnavailablePeriodSchema>;

/**
 * SCRUM-151 AC2, by time: one notice mark_period_unavailable wrote, as it
 * returns it: the affected event, its coordinator, the withdrawn period and
 * the reason.
 */
export const NoticeWrittenSchema = z.object({
  eventRequestId: z.string().uuid(),
  coordinatorId: z.string().uuid(),
  date: z.string(),
  start: z.string(),
  end: z.string(),
  reason: z.string(),
});

// -----------------------------------------------------------------------------
// SCRUM-239 Check venue availability in 15-minute time ranges
// -----------------------------------------------------------------------------

/**
 * What can commit a venue's time, so that no one else can book it:
 * - `booking`: a confirmed booking (SCRUM-155 approves it).
 * - `hold`: an active hold that has not expired (SCRUM-227, Hold a venue
 *   until an expiry), with its event and expiry.
 * - `unavailable`: a period Venue Staff withdrew (SCRUM-151), labelled
 *   Blocked on the calendar (SCRUM-123 AC7).
 *
 * A pending booking request commits nothing: several can ask for the same
 * period, and Venue Staff's approval decides (SCRUM-239 AC4).
 */
export const COMMITMENT_KINDS = ['booking', 'hold', 'unavailable'] as const;
export type CommitmentKind = (typeof COMMITMENT_KINDS)[number];

/**
 * One committed period at a venue on one date, as getVenueCommitments returns
 * it. Times are Singapore clock times on the 15-minute unit, half-open.
 *
 * `eventRequestId` and `reason` are for callers whose story lets the viewer see
 * them (Venue Staff deciding an approval, SCRUM-155 AC5). Anyone else is told
 * only the period: SCRUM-239 AC3 refuses a request "without any other event's
 * details", and SCRUM-226 AC4 shows a committed period "with no details of the
 * other event".
 */
export const VenueCommitmentSchema = z.object({
  kind: z.enum(COMMITMENT_KINDS),
  venueId: z.string().uuid(),
  date: z.string().refine(isISODate),
  start: StartTimeSchema,
  end: EndTimeSchema,
  eventRequestId: z.string().uuid().nullable(),
  reason: z.string().nullable(),
  /**
   * SCRUM-227: a hold's expiry (an ISO instant), so it can be named and shown
   * as Held with its expiry (AC4, AC7). Left out for bookings and unavailable
   * periods, which do not expire.
   */
  expiresAt: z.string().nullable().optional(),
});
export type VenueCommitment = z.infer<typeof VenueCommitmentSchema>;

/**
 * A committed period with nothing about who or what holds it: the date and
 * times only. What a coordinator or organiser may be shown (SCRUM-239 AC3:
 * "without any other event's details"; SCRUM-226 AC4: "with no details of the
 * other event").
 */
export interface CommittedPeriod {
  date: string;
  start: string;
  end: string;
}
