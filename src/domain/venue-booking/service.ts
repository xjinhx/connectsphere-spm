import {
  CreateVenueBookingRequestInputSchema,
  EventRequestIdSchema,
  type VenueBookingRequestOutcome,
} from './schema';
import { canCreateBookingRequest } from './policy';
import { isCurrentCoordinator } from '@/domain/assignment/policy';
import { fetchEventRequestById } from '@/lib/supabase/eventRequests';
import type { EventRequestRow } from '@/lib/supabase/eventRequests';
import {
  createVenueBookingRequest,
  fetchVenueBookingRequestById,
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

  const parsedInput = CreateVenueBookingRequestInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new ValidationError('The venue booking request is not valid.', parsedInput.error.flatten());
  }

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
