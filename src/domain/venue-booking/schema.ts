import { z } from 'zod';
import { isISODate } from '@/domain/shared/dates';
import { TimeSlotEnum, type TimeSlot } from '@/domain/event-request/schema';

// ---------------------------------------------------------------------------
// SCRUM-142 — Submit a venue booking request for an event
// ---------------------------------------------------------------------------
// AC1: one venue, a date, and the required slots. AC3: several dates for the
// same venue are lines on the SAME request, not separate requests, each with
// its own independent decision status. A line's identity is (date,
// timeSlots) — the same shape event_request's own timeSlots already uses
// (SCRUM-77), reused here rather than invented fresh.

// Same convention as review/schema.ts's own EventRequestIdSchema: each
// domain validates the id shape locally rather than importing another
// domain's copy of the same one-liner.
export const EventRequestIdSchema = z.string().uuid();

export const VenueBookingRequestLineInputSchema = z.object({
  date: z.coerce.date(),
  timeSlots: z.array(TimeSlotEnum).min(1, 'Select at least one time slot for this date.'),
});
export type VenueBookingRequestLineInput = z.infer<typeof VenueBookingRequestLineInputSchema>;

export const CreateVenueBookingRequestInputSchema = z.object({
  venueId: z.string().uuid('Venue must be chosen from the list.'),
  lines: z.array(VenueBookingRequestLineInputSchema).min(1, 'At least one date is required.'),
});
export type CreateVenueBookingRequestInput = z.infer<typeof CreateVenueBookingRequestInputSchema>;

// SCRUM-142 only ever creates pending lines. SCRUM-148 adds deciding one:
// approved or rejected (20261006100000_venue_booking_decision.sql).
export const VenueBookingRequestLineStatusEnum = z.enum(['pending', 'approved', 'rejected']);
export type VenueBookingRequestLineStatus = z.infer<typeof VenueBookingRequestLineStatusEnum>;

export interface VenueBookingRequestLine {
  id: string;
  date: string;
  timeSlots: readonly string[];
  status: VenueBookingRequestLineStatus;
}

/** AC1/AC3 — what the coordinator sees back after submitting: the request and every line on it. */
export interface VenueBookingRequestOutcome {
  id: string;
  eventRequestId: string;
  venueId: string;
  lines: readonly VenueBookingRequestLine[];
}

// ---------------------------------------------------------------------------
// SCRUM-148 — Approve a booking request
// ---------------------------------------------------------------------------

export const VenueBookingRequestIdSchema = z.string().uuid();

/**
 * AC1 and AC5: a request's status, worked out from its lines (requestStatusOf
 * in policy.ts) rather than stored, so the request and its lines can never
 * disagree.
 */
export const VenueBookingRequestStatusEnum = z.enum(['pending', 'approved', 'partially_approved', 'rejected']);
export type VenueBookingRequestStatus = z.infer<typeof VenueBookingRequestStatusEnum>;

/**
 * AC5: one decision for each pending line. A rejected line needs a reason; an
 * approved one doesn't take one.
 */
export const DecideVenueBookingRequestInputSchema = z.object({
  decisions: z
    .array(
      z.object({
        lineId: z.string().uuid('Each decision must name a line of this request.'),
        decision: z.enum(['approve', 'reject']),
        reason: z.string().optional(),
      }),
    )
    .min(1, 'Decide at least one line.')
    .refine((decisions) => new Set(decisions.map((d) => d.lineId)).size === decisions.length, 'Each line can only be decided once.')
    .refine(
      (decisions) => decisions.every((d) => d.decision === 'approve' || (d.reason ?? '').trim().length > 0),
      'A reason is required for each rejected line.',
    ),
});
export type DecideVenueBookingRequestInput = z.infer<typeof DecideVenueBookingRequestInputSchema>;

/** AC1 and AC5: a line as decided: who decided, when, and why if rejected. */
export interface DecidedVenueBookingRequestLine {
  id: string;
  date: string;
  timeSlots: readonly string[];
  status: VenueBookingRequestLineStatus;
  decidedBy: string | null;
  /** The decider's name, for the page; null while pending or if the account has no name. */
  decidedByName: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
}

/** A booking request with its status and decided lines. */
export interface VenueBookingDecision {
  id: string;
  eventRequestId: string;
  venueId: string;
  /** AC2: the event's assigned coordinator, the one the decision is for. */
  coordinatorId: string | null;
  status: VenueBookingRequestStatus;
  lines: readonly DecidedVenueBookingRequestLine[];
}

/**
 * AC3 and AC4: the dates a venue's calendar covers. A range of whole days,
 * from on or before to.
 */
export const VenueBookingRangeSchema = z
  .object({
    from: z.string({ required_error: 'from is required (YYYY-MM-DD).' }).refine(isISODate, 'from must be a date (YYYY-MM-DD).'),
    to: z.string({ required_error: 'to is required (YYYY-MM-DD).' }).refine(isISODate, 'to must be a date (YYYY-MM-DD).'),
  })
  .refine((range) => range.from <= range.to, 'from must be on or before to.');

/**
 * AC3 and AC4: one booked slot as a viewer may see it. Venue Staff, the event's
 * assigned coordinator and Event Operations Managers see a confirmed booking
 * with its event; any other internal user sees only that the slot is committed,
 * with no event, client or coordinator details.
 */
export type BookedSlot =
  | { date: string; slot: string; state: 'confirmed'; event: { id: string; reference: string; name: string } }
  | { date: string; slot: string; state: 'committed' };

// ---------------------------------------------------------------------------
// SCRUM-147 — View the pending booking request queue
// ---------------------------------------------------------------------------
// One entry per pending line, not per request: each date-and-slots line is
// decided on its own (SCRUM-148 AC5), so each one leaves the queue on its own.

/** AC1 — one row of the queue: venue, event, requested date and slots, and when it was requested. */
export interface BookingQueueEntry {
  lineId: string;
  requestId: string;
  venueName: string;
  eventName: string;
  eventReference: string;
  /** The requested date, YYYY-MM-DD. */
  date: string;
  timeSlots: readonly TimeSlot[];
  /** When the request was made (timestamptz). */
  requestedAt: string;
}

// ---------------------------------------------------------------------------
// SCRUM-143 — Include the requirements Venue Staff need
// ---------------------------------------------------------------------------

/**
 * What SCRUM-143 adds to SCRUM-148's decision page. That page already lists
 * each requested date and its slots (AC1); this adds the event's reference and
 * the requesting coordinator (AC1), and the event's attendance, layout and
 * accessibility needs as recorded on the event (AC2). Values are as stored;
 * policy.ts says how a missing one reads (AC4).
 */
export interface BookingRequestRequirements {
  eventName: string;
  eventReference: string;
  /** Null when the coordinator's profile has no name recorded. */
  requestedByName: string | null;
  requestedAt: string;
  expectedAttendance: number | null;
  roomLayout: string | null;
  accessibilityRequired: boolean | null;
  accessibilityFeatures: readonly { name: string }[];
  accessibilityNotes: string | null;
}
