import { z } from 'zod';
import { fetchEventRequestById, type EventRequestRow } from '@/lib/supabase/eventRequests';
import { fetchSuitabilityChecks, insertSuitabilityCheck } from '@/lib/supabase/suitabilityChecks';
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
 * SCRUM-135 AC4 and SCRUM-136 AC5, a booking request's own attendance and
 * layout, wait on SCRUM-230, which gives each booking request its own. Until
 * then every check uses the event's.
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
 * and the venue's values side by side.
 *
 * SCRUM-135 AC3: every run is stored, with the requirements it used, so it can
 * be shown again without running it (listSuitabilityChecks).
 */
export async function checkVenueSuitability(
  eventRequestId: string,
  input: unknown,
  actorId: string,
): Promise<SuitabilityCheck> {
  if (!EventRequestIdSchema.safeParse(eventRequestId).success) throw new NotFoundError('Event request');
  const parsed = CheckSuitabilityInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Choose a venue.', parsed.error.flatten());
  }
  const event = await readEventForCheck(eventRequestId, actorId);

  // Throws NotFoundError for a venue that does not exist.
  const venue = await getVenue(parsed.data.venueId);

  const requirements = [capacityRequirement(event.needs, venue)];
  const verdict = verdictOf(requirements);

  const { data: stored, error } = await insertSuitabilityCheck({
    eventRequestId: event.id,
    venueId: venue.id,
    verdict,
    requirements,
    needs: { expectedAttendance: event.needs.expectedAttendance, roomLayout: event.needs.roomLayout },
    checkedBy: actorId,
  });
  if (error || !stored) throw new ValidationError('The suitability check could not be saved.', error?.message);

  return SuitabilityCheckSchema.parse({
    eventRequestId: event.id,
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
 * SCRUM-135 AC3: the latest stored check of each venue for the event, newest
 * first, as they were run: verdict, requirements and the time each was run.
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
    if (latest.has(row.venue_id)) continue; // newest first, so the first is the latest
    const needs = StoredNeedsSchema.safeParse(row.needs);
    latest.set(
      row.venue_id,
      SuitabilityCheckSchema.parse({
        eventRequestId: event.id,
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
