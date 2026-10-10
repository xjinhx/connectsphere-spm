import { z } from 'zod';
import { EndTimeSchema, StartTimeSchema } from '@/domain/shared/times';
import { isISODate } from '@/domain/shared/dates';
import { OperatingSlotSchema, type OperatingSlot } from '@/domain/venues/schema';

/**
 * Venue availability (EP-13): data shapes shared by the API route and the UI.
 *
 * SCRUM-151 Withdraw venue availability when circumstances change
 *
 * An unavailable slot (CONTEXT.md) is one slot at one venue on one date that
 * Venue Staff have withdrawn from use, with the reason recorded. Values mirror
 * the check constraints in
 * supabase/migrations/20261007110000_venue_unavailable_slot.sql.
 *
 * Slots reuse the venue catalogue's AM / PM / Night list (OperatingSlotSchema)
 * rather than a second copy of the same three values.
 */

/** Short names for messages and lists: "AM", not "AM (07:00-12:00)". */
export const SLOT_NAMES: Record<OperatingSlot, string> = {
  am: 'AM',
  pm: 'PM',
  night: 'Night',
};

/**
 * SCRUM-151 AC1: "I select a venue, a date and the affected slots and record a
 * reason". The venue comes from the URL. Several slots can be ticked in one
 * save, and each is recorded as its own unavailable slot.
 */
export const MarkSlotsUnavailableInputSchema = z.object({
  date: z.string({ required_error: 'Choose a date.' }).refine(isISODate, 'Choose a valid date.'),
  slots: z
    .array(OperatingSlotSchema, { required_error: 'Select at least one slot.' })
    .min(1, 'Select at least one slot.')
    .refine((slots) => new Set(slots).size === slots.length, 'Each slot can only be selected once.'),
  reason: z.string({ required_error: 'A reason is required.' }).trim().min(1, 'A reason is required.'),
});
export type MarkSlotsUnavailableInput = z.infer<typeof MarkSlotsUnavailableInputSchema>;

/**
 * SCRUM-151 AC3: an affected booking (CONTEXT.md) as the coordinator's event
 * page lists it: which venue and date, and each of its slots that has been
 * withdrawn, with the reason recorded for it.
 */
export const BookingOnUnavailableSlotSchema = z.object({
  bookingId: z.string().uuid(),
  venueId: z.string().uuid(),
  venueName: z.string(),
  date: z.string(),
  slots: z.array(z.object({ slot: OperatingSlotSchema, reason: z.string() })).min(1),
});
export type BookingOnUnavailableSlot = z.infer<typeof BookingOnUnavailableSlotSchema>;

/** One recorded unavailable slot, as the API and the venue page show it. */
export const UnavailableSlotSchema = z.object({
  id: z.string().uuid(),
  venueId: z.string().uuid(),
  date: z.string(),
  slot: OperatingSlotSchema,
  reason: z.string(),
  recordedAt: z.string(),
});
export type UnavailableSlot = z.infer<typeof UnavailableSlotSchema>;

/**
 * SCRUM-151 AC2: one notice mark_slots_unavailable wrote, as it returns it: the
 * affected event, its coordinator, the withdrawn slots it uses, and the reason.
 */
export const NoticeWrittenSchema = z.object({
  eventRequestId: z.string().uuid(),
  coordinatorId: z.string().uuid(),
  date: z.string(),
  slots: z.array(OperatingSlotSchema),
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
