import { fetchEventRequestById, type EventRequestRow } from '@/lib/supabase/eventRequests';
import { fetchBookingRequestForCheck } from '@/lib/supabase/suitability';
import { ForbiddenError, NotFoundError, ValidationError } from '@/domain/shared/errors';
import { isCurrentCoordinator } from '@/domain/assignment/policy';
import { EventRequestIdSchema } from '@/domain/venue-booking/schema';
import { markIfEvents, venueRequirementsOf } from '@/domain/venue-booking/policy';
import { getVenue } from '@/domain/venues/service';
import { capacityRequirement, needsOfRequest, toRoomLayout, verdictOf, type SuitabilityNeeds } from './policy';
import { CheckSuitabilityInputSchema, SuitabilityResultSchema, type SuitabilityResult } from './schema';

/**
 * Venue suitability service (SCRUM-136 Flag a venue whose capacity is
 * exceeded).
 *
 * Orchestration only: the event and venue are read through their own
 * services' queries, the rules are policy.ts's.
 *
 * Who may check: the event's assigned coordinator, the same as requesting a
 * venue for it (SCRUM-142 AC4). The story is the coordinator's ("so that a
 * room that cannot hold the event is never requested"), and the check reads
 * the event's protected details (customer clarification #91). The route also
 * requires the coordinator role (event_request_review).
 *
 * SCRUM-136 AC5: a check can be for one of the event's booking requests
 * instead, at that request's venue, using the request's own attendance and
 * layout and the event's for any it left empty. Which one applies is
 * SCRUM-230's venueRequirementsOf, not repeated here.
 */
export async function checkVenueSuitability(
  eventRequestId: string,
  input: unknown,
  actorId: string,
): Promise<SuitabilityResult> {
  if (!EventRequestIdSchema.safeParse(eventRequestId).success) throw new NotFoundError('Event request');
  const parsed = CheckSuitabilityInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? 'Choose a venue, or one of the booking requests.',
      parsed.error.flatten(),
    );
  }

  const { data, error } = await fetchEventRequestById(eventRequestId);
  if (error) throw new ValidationError('The event request could not be read.', error.message);
  if (!data) throw new NotFoundError('Event request');
  const event = data as unknown as EventRequestRow;

  // Refused before the venue is read, so a coordinator this event is not
  // assigned to learns nothing from the answer.
  if (!isCurrentCoordinator(event.coordinator_id, actorId)) {
    throw new ForbiddenError('This event is not assigned to you.');
  }

  // AC5: a booking request brings its own venue. One that is not this event's
  // is treated as not found, so nothing about another event is given away.
  let venueId = parsed.data.venueId;
  let bookingRequestId: string | null = null;
  let needs: SuitabilityNeeds = { expectedAttendance: event.expected_attendance, roomLayout: toRoomLayout(event.room_layout) };
  let attendanceFromEvent = false;
  if (parsed.data.bookingRequestId !== undefined) {
    const { data: bookingRequest, error: requestError } = await fetchBookingRequestForCheck(parsed.data.bookingRequestId);
    if (requestError) throw new ValidationError('The booking request could not be read.', requestError.message);
    if (!bookingRequest || bookingRequest.event_request_id !== event.id) throw new NotFoundError('Venue booking request');
    venueId = bookingRequest.venue_id;
    bookingRequestId = bookingRequest.id;
    // AC5: the request's own attendance and layout, else the event's (SCRUM-230).
    const inUse = venueRequirementsOf(
      {
        expectedAttendance: bookingRequest.expected_attendance,
        roomLayout: bookingRequest.room_layout,
        accessibilityRequired: bookingRequest.accessibility_required,
        accessibilityNotes: bookingRequest.accessibility_notes,
      },
      {
        expectedAttendance: event.expected_attendance,
        roomLayout: event.room_layout,
        accessibilityRequired: event.accessibility_required,
        accessibilityNotes: event.accessibility_notes,
        accessibilityFeatures: event.event_request_accessibility_features.flatMap((link) =>
          link.accessibility_features ? [{ name: link.accessibility_features.name }] : [],
        ),
      },
    );
    needs = needsOfRequest(inUse);
    attendanceFromEvent = inUse.expectedAttendance.fromEvent;
  }

  // Throws NotFoundError for a venue that does not exist. The schema makes
  // sure one of the two was given, so venueId is set here.
  const venue = await getVenue(venueId ?? '');

  const capacity = capacityRequirement(needs, venue);
  // A request that left its attendance empty is shown as using the event's (SCRUM-230 AC2).
  const requirements = [
    bookingRequestId && attendanceFromEvent
      ? { ...capacity, eventValue: markIfEvents(capacity.eventValue, { fromEvent: true }) }
      : capacity,
  ];

  return SuitabilityResultSchema.parse({
    eventRequestId: event.id,
    bookingRequestId,
    venue: { id: venue.id, name: venue.name },
    verdict: verdictOf(requirements),
    requirements,
  });
}
