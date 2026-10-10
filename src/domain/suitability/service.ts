import { fetchEventRequestById, type EventRequestRow } from '@/lib/supabase/eventRequests';
import { ForbiddenError, NotFoundError, ValidationError } from '@/domain/shared/errors';
import { isCurrentCoordinator } from '@/domain/assignment/policy';
import { EventRequestIdSchema } from '@/domain/venue-booking/schema';
import { getVenue } from '@/domain/venues/service';
import { capacityRequirement, needsFor, toRoomLayout, verdictOf } from './policy';
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
 * SCRUM-136 AC5, a booking request's own attendance, is needsFor's (policy.ts)
 * and waits on SCRUM-230, which gives each booking request its own attendance,
 * layout and accessibility needs. Until then every check uses the event's.
 */
export async function checkVenueSuitability(
  eventRequestId: string,
  input: unknown,
  actorId: string,
): Promise<SuitabilityResult> {
  if (!EventRequestIdSchema.safeParse(eventRequestId).success) throw new NotFoundError('Event request');
  const parsed = CheckSuitabilityInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Choose a venue.', parsed.error.flatten());
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

  // Throws NotFoundError for a venue that does not exist.
  const venue = await getVenue(parsed.data.venueId);

  const needs = needsFor({ expectedAttendance: event.expected_attendance, roomLayout: toRoomLayout(event.room_layout) });
  const requirements = [capacityRequirement(needs, venue)];

  return SuitabilityResultSchema.parse({
    eventRequestId: event.id,
    venue: { id: venue.id, name: venue.name },
    verdict: verdictOf(requirements),
    requirements,
  });
}
