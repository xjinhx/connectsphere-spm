import { z } from 'zod';
import { fetchEventRequestById, type EventRequestRow } from '@/lib/supabase/eventRequests';
import { fetchSuitabilityChecks, insertSuitabilityCheck } from '@/lib/supabase/suitabilityChecks';
import { fetchBookingRequestForCheck } from '@/lib/supabase/suitability';
import { ForbiddenError, NotFoundError, ValidationError } from '@/domain/shared/errors';
import { isCurrentCoordinator } from '@/domain/assignment/policy';
import { EventRequestIdSchema } from '@/domain/venue-booking/schema';
import { RoomLayoutSchema } from '@/domain/venues/schema';
import { getVenue } from '@/domain/venues/service';
import { capacityRequirement, needsFor, sameNeeds, toRoomLayout, verdictOf, type SuitabilityNeeds } from './policy';
import {
  CheckSuitabilityInputSchema,
  RequirementResultSchema,
  SuitabilityCheckSchema,
  VERDICTS,
  type SuitabilityCheck,
} from './schema';

/**
 * Venue suitability service (SCRUM-135 Check a selected venue against the
 * event's requirements, SCRUM-136 Flag a venue whose capacity is exceeded).
 *
 * Orchestration only: the event and venue are read through their own
 * services' queries, the rules are policy.ts's, and stored checks go through
 * src/lib/supabase/suitabilityChecks.ts.
 *
 * Who may check, and see the checks: the event's assigned coordinator, the
 * same as requesting a venue for it (SCRUM-142 AC4). The stories are the
 * coordinator's ("before I ask Venue Staff to assess a booking"), and a check
 * reads the event's protected details (customer clarification #91). The route
 * also requires the coordinator role (venue_booking_request).
 *
 * Requirement checked: capacity (SCRUM-136). SCRUM-135 checks capacity only
 * (PO decision, Slack 10 Oct 2026); layouts, facilities, accessibility and
 * operating hours are SCRUM-137's, in no sprint yet, and add to
 * `requirements` here when it is built.
 *
 * SCRUM-135 AC4 and SCRUM-136 AC5: a check can be for one of the event's
 * booking requests instead, at that request's venue. The request's own
 * attendance and layout are SCRUM-230's (#106); until it is merged a request
 * has none, so the event's are used.
 */

/** The event, once the actor is known to be its coordinator, with what the check needs from it. */
async function readEventForCheck(eventRequestId: string, actorId: string): Promise<{ id: string; needs: SuitabilityNeeds }> {
  if (!EventRequestIdSchema.safeParse(eventRequestId).success) throw new NotFoundError('Event request');

  const { data, error } = await fetchEventRequestById(eventRequestId);
  if (error) throw new ValidationError('The event request could not be read.', error.message);
  if (!data) throw new NotFoundError('Event request');
  const event = data as unknown as EventRequestRow;

  // Refused before anything else is read, so a coordinator this event is not
  // assigned to learns nothing from the answer.
  if (!isCurrentCoordinator(event.coordinator_id, actorId)) {
    throw new ForbiddenError('This event is not assigned to you.');
  }

  return {
    id: event.id,
    needs: needsFor({ expectedAttendance: event.expected_attendance, roomLayout: toRoomLayout(event.room_layout) }),
  };
}

/**
 * SCRUM-135 AC1 and AC2, SCRUM-136 AC1 to AC4: check a selected venue against
 * the event, giving exactly one verdict and every requirement with the event's
 * and the venue's values side by side. SCRUM-135 AC4, SCRUM-136 AC5: or check
 * one of the event's booking requests, at that request's venue.
 *
 * SCRUM-135 AC3: every run is stored, with the requirements it used and the
 * request it was for, so it can be shown again without running it
 * (listSuitabilityChecks).
 */
export async function checkVenueSuitability(
  eventRequestId: string,
  input: unknown,
  actorId: string,
): Promise<SuitabilityCheck> {
  if (!EventRequestIdSchema.safeParse(eventRequestId).success) throw new NotFoundError('Event request');
  const parsed = CheckSuitabilityInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? 'Choose a venue, or one of the booking requests.',
      parsed.error.flatten(),
    );
  }
  const event = await readEventForCheck(eventRequestId, actorId);

  // AC5: a booking request brings its own venue. One that is not this event's
  // is treated as not found, so nothing about another event is given away.
  let venueId = parsed.data.venueId;
  let bookingRequestId: string | null = null;
  if (parsed.data.bookingRequestId !== undefined) {
    const { data: bookingRequest, error: requestError } = await fetchBookingRequestForCheck(parsed.data.bookingRequestId);
    if (requestError) throw new ValidationError('The booking request could not be read.', requestError.message);
    if (!bookingRequest || bookingRequest.event_request_id !== event.id) throw new NotFoundError('Venue booking request');
    venueId = bookingRequest.venue_id;
    bookingRequestId = bookingRequest.id;
  }

  // Throws NotFoundError for a venue that does not exist. The schema makes
  // sure one of the two was given, so venueId is set here.
  const venue = await getVenue(venueId ?? '');

  const requirements = [capacityRequirement(event.needs, venue)];
  const verdict = verdictOf(requirements);

  const { data: stored, error } = await insertSuitabilityCheck({
    eventRequestId: event.id,
    venueId: venue.id,
    bookingRequestId,
    verdict,
    requirements,
    needs: { expectedAttendance: event.needs.expectedAttendance, roomLayout: event.needs.roomLayout },
    checkedBy: actorId,
  });
  if (error || !stored) throw new ValidationError('The suitability check could not be saved.', error?.message);

  return SuitabilityCheckSchema.parse({
    eventRequestId: event.id,
    bookingRequestId,
    venue: { id: venue.id, name: venue.name },
    verdict,
    requirements,
    checkedAt: stored.checked_at,
    outOfDate: false,
  });
}

/** A stored check's `needs`, read back. Anything unreadable counts as changed. */
const StoredNeedsSchema = z.object({
  expectedAttendance: z.number().int().nullable(),
  roomLayout: RoomLayoutSchema.nullable(),
});

/**
 * SCRUM-135 AC3: the latest stored check of each venue for the event, and of
 * each booking request checked for (SCRUM-136 AC5), newest first, as they
 * were run: verdict, requirements and the time each was run.
 * Nothing is run again. A check whose event requirements have changed since is
 * marked out of date rather than dropped, so the coordinator can see it needs
 * running again.
 */
export async function listSuitabilityChecks(eventRequestId: string, actorId: string): Promise<SuitabilityCheck[]> {
  const event = await readEventForCheck(eventRequestId, actorId);

  const { data, error } = await fetchSuitabilityChecks(event.id);
  if (error || !data) throw new ValidationError('The suitability checks could not be read.', error?.message);

  const latest = new Map<string, SuitabilityCheck>();
  for (const row of data) {
    const key = row.venue_booking_request_id ? `request:${row.venue_booking_request_id}` : `venue:${row.venue_id}`;
    if (latest.has(key)) continue; // newest first, so the first is the latest
    const needs = StoredNeedsSchema.safeParse(row.needs);
    latest.set(
      key,
      SuitabilityCheckSchema.parse({
        eventRequestId: event.id,
        bookingRequestId: row.venue_booking_request_id,
        venue: { id: row.venue_id, name: row.venues.name },
        verdict: z.enum(VERDICTS).parse(row.verdict),
        requirements: RequirementResultSchema.array().parse(row.requirements),
        checkedAt: row.checked_at,
        outOfDate: !needs.success || !sameNeeds(needs.data, event.needs),
      }),
    );
  }
  return [...latest.values()];
}
