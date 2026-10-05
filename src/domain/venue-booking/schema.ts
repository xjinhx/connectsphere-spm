import { z } from 'zod';
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

// Only 'pending' exists — this ticket only ever creates pending lines.
// Deciding one is SCRUM-147-150's job (Venue Booking Approval), which may
// widen this the same way SCRUM-92/93 widened event_request_status.
export const VenueBookingRequestLineStatusEnum = z.enum(['pending']);
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
