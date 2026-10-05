import {
  CreateVenueBookingRequestInputSchema,
  EventRequestIdSchema,
  type BookingQueueEntry,
  type VenueBookingRequestOutcome,
} from './schema';
import { canCreateBookingRequest, sortBookingQueue, type BookingQueueSort } from './policy';
import { isCurrentCoordinator } from '@/domain/assignment/policy';
import { TimeSlotEnum, type TimeSlot } from '@/domain/event-request/schema';
import { fetchEventRequestById } from '@/lib/supabase/eventRequests';
import type { EventRequestRow } from '@/lib/supabase/eventRequests';
import {
  createVenueBookingRequest,
  fetchPendingBookingLines,
  fetchVenueBookingRequestById,
  type PendingBookingLineRow,
  type VenueBookingRequestRow,
} from '@/lib/supabase/venueBookingRequests';
import {
  NotFoundError,
  ValidationError,
  ForbiddenError,
} from '@/domain/shared/errors';

const EVENT_NOT_APPROVED_MESSAGE =
  'The event must be approved before venue arrangements can begin.';

function toOutcome(row: VenueBookingRequestRow): VenueBookingRequestOutcome {
  return {
    id: row.id,
    eventRequestId: row.event_request_id,
    venueId: row.venue_id,
    lines: row.venue_booking_request_line.map((line) => ({
      id: line.id,
      date: line.date,
      timeSlots: line.time_slots,
      status: line.status,
    })),
  };
}

/**
 * SCRUM-142 AC1-AC4 — submit a venue booking request for an event.
 *
 * `actorId` is the assigned coordinator submitting it, supplied by the route
 * from the signed-in session — never chosen by whoever sends the request,
 * the same convention as approveEventRequest (SCRUM-92).
 */
export async function submitVenueBookingRequest(
  eventRequestId: string,
  actorId: string,
  input: unknown,
): Promise<VenueBookingRequestOutcome> {
  const parsedId = EventRequestIdSchema.safeParse(eventRequestId);
  if (!parsedId.success) throw new NotFoundError('Event request');

  const { data: existing, error: readError } = await fetchEventRequestById(parsedId.data);
  if (readError) {
    throw new ValidationError('The event request could not be read.', readError.message);
  }
  if (!existing) throw new NotFoundError('Event request');

  const event = existing as unknown as EventRequestRow;

  // AC4 — refused before AC2's status check, the same ordering
  // approveEventRequest uses for its own assigned-coordinator check: a
  // coordinator this event is not assigned to should learn nothing about it,
  // not even whether it is approved yet.
  if (!isCurrentCoordinator(event.coordinator_id, actorId)) {
    throw new ForbiddenError('This event is not assigned to you.');
  }

  // AC2
  if (!canCreateBookingRequest(event.status)) {
    throw new ValidationError(EVENT_NOT_APPROVED_MESSAGE);
  }

  // AC5 — only reached for the assigned coordinator of an approved event, so
  // an unapproved event is always told it must be approved first (AC2), never
  // which fields are missing.
  const parsedInput = CreateVenueBookingRequestInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new ValidationError('The venue booking request is not valid.', parsedInput.error.flatten());
  }

  const { data: newRequestId, error: writeError } = await createVenueBookingRequest({
    eventRequestId: parsedId.data,
    venueId: parsedInput.data.venueId,
    requestedBy: actorId,
    lines: parsedInput.data.lines.map((line) => ({
      date: line.date.toISOString().slice(0, 10),
      timeSlots: line.timeSlots,
    })),
  });

  if (writeError || !newRequestId) {
    throw new ValidationError('The venue booking request could not be created.', writeError?.message);
  }

  const { data: created, error: rereadError } = await fetchVenueBookingRequestById(newRequestId);
  if (rereadError) {
    throw new ValidationError('The venue booking request could not be read back.', rereadError.message);
  }
  // Written a moment ago by the statement above — a missing row here means
  // something else deleted it in between, not that creation failed.
  if (!created) throw new NotFoundError('Venue booking request');

  // This function's job ends here: the request and its lines exist. Whether
  // and how the event's own status reacts to that (SCRUM-101 AC3) is
  // SCRUM-101's concern, not this one's — see that ticket's notes on how it
  // intends to observe a new venue_booking_request row (e.g. a database
  // trigger on this table) once it can be written against a real one.

  return toOutcome(created as unknown as VenueBookingRequestRow);
}

// ---------------------------------------------------------------------------
// SCRUM-147 — View the pending booking request queue
// ---------------------------------------------------------------------------

function toQueueEntry(row: PendingBookingLineRow): BookingQueueEntry {
  const request = row.venue_booking_request;
  // Postgres guarantees each line has a request, venue and event (NOT NULL
  // foreign keys); the generated embed types cannot say so.
  if (!request?.venues || !request.event_request) {
    throw new ValidationError('A booking request line is missing its request, venue or event.', { lineId: row.id });
  }
  return {
    lineId: row.id,
    requestId: request.id,
    venueName: request.venues.name,
    eventName: request.event_request.name,
    eventReference: request.event_request.reference,
    date: row.date,
    // The table's check constraint allows only these three values.
    timeSlots: row.time_slots.filter((slot): slot is TimeSlot => TimeSlotEnum.safeParse(slot).success),
    requestedAt: request.created_at,
  };
}

/**
 * SCRUM-147 AC1, AC3, AC4 — every pending line, at every venue, in the order
 * `sort` asks for (sortBookingQueue, policy.ts).
 *
 * Who may see it (Venue Staff, venue_booking_review) is checked by the page
 * before this is called, the same split as listVenues (SCRUM-121).
 */
export async function listPendingBookingQueue(sort: BookingQueueSort = 'requested'): Promise<BookingQueueEntry[]> {
  const { data, error } = await fetchPendingBookingLines();
  if (error || !data) {
    throw new ValidationError('Could not load the booking request queue.', error?.message);
  }
  const entries = (data as unknown as PendingBookingLineRow[]).map(toQueueEntry);
  return sortBookingQueue(entries, sort);
}
