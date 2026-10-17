import { EssentialArrangementsInputSchema, type ArrangementNeeds, type EssentialArrangementsView } from './schema';
import {
  NO_ARRANGEMENTS_RECORDED,
  canChangeEssentialArrangements,
  essentialArrangementsIn,
  essentialArrangementsRefusal,
} from './policy';
import { EventRequestIdSchema } from '@/domain/event-status/schema';
import { EventRequestStatusEnum, type EventRequestStatus } from '@/domain/event-request/schema';
import { isCurrentCoordinator } from '@/domain/assignment/policy';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/domain/shared/errors';
import { fetchEventRequestById, type EventRequestRow } from '@/lib/supabase/eventRequests';
import { fetchEssentialArrangements, recordEssentialArrangementsRow } from '@/lib/supabase/essentialArrangements';

/**
 * SCRUM-100 — Record which arrangements are essential for an event.
 */

type EssentialArrangementsRow = {
  venue: boolean;
  equipment: boolean;
  technical_support: boolean;
  registration: boolean;
};

const need = (essential: boolean) => (essential ? 'essential' : 'not_required');

function needsFrom(row: EssentialArrangementsRow | null): ArrangementNeeds {
  if (!row) return NO_ARRANGEMENTS_RECORDED;
  return {
    venue: need(row.venue),
    equipment: need(row.equipment),
    technicalSupport: need(row.technical_support),
    registration: need(row.registration),
  };
}

async function readEvent(eventRequestId: string): Promise<Pick<EventRequestRow, 'status' | 'coordinator_id'>> {
  if (!EventRequestIdSchema.safeParse(eventRequestId).success) throw new NotFoundError('Event request');
  const { data, error } = await fetchEventRequestById(eventRequestId);
  if (error) throw new ValidationError('The event request could not be read.', error.message);
  if (!data) throw new NotFoundError('Event request');
  return data as unknown as EventRequestRow;
}

/**
 * AC2: the event's essential set for its page. No set recorded reads as none
 * essential, the same as a set of four not required (TC-100-05, TC-100-06).
 * canChange says whether to offer the form (AC1, AC3).
 *
 * No access check of its own, the same as listEventVenueBookings (SCRUM-231):
 * its only caller is the coordinator's review page, which calls it after
 * getReviewDetail has refused anyone the request is not theirs to see.
 */
export async function getEssentialArrangements(eventRequestId: string, actorId: string): Promise<EssentialArrangementsView> {
  const event = await readEvent(eventRequestId);

  const { data, error } = await fetchEssentialArrangements(eventRequestId);
  if (error) throw new ValidationError("The event's essential arrangements could not be read.", error.message);

  const needs = needsFrom(data as EssentialArrangementsRow | null);
  return {
    needs,
    essential: essentialArrangementsIn(needs),
    canChange: isCurrentCoordinator(event.coordinator_id, actorId) && canChangeEssentialArrangements(event.status),
    changeRefusal: essentialArrangementsRefusal(event.status),
  };
}

/**
 * AC1: the event's assigned coordinator records which arrangements are
 * essential; the new set replaces any earlier one. AC3: refused on a Confirmed
 * event until it is returned to Planning.
 *
 * Checked in the same order as releaseVenueBooking (SCRUM-231): the
 * coordinator first, so someone the event is not assigned to learns nothing
 * more about it, then the input, then the status. The database function checks
 * the coordinator and status again with the event row locked, so an event
 * Confirmed after this read is still refused (TC-100-10).
 *
 * `actorId` is whoever is signed in, from the route, never from the body.
 */
export async function recordEssentialArrangements(
  eventRequestId: string,
  actorId: string,
  input: unknown,
): Promise<ArrangementNeeds> {
  const event = await readEvent(eventRequestId);

  if (!isCurrentCoordinator(event.coordinator_id, actorId)) {
    throw new ForbiddenError('This event is not assigned to you.');
  }

  const parsed = EssentialArrangementsInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? 'The essential arrangements are not valid.',
      parsed.error.flatten(),
    );
  }

  const refusal = essentialArrangementsRefusal(event.status);
  if (refusal) throw new ConflictError(refusal);

  const needs = parsed.data;
  const { data: outcome, error } = await recordEssentialArrangementsRow(eventRequestId, actorId, {
    venue: needs.venue === 'essential',
    equipment: needs.equipment === 'essential',
    technicalSupport: needs.technicalSupport === 'essential',
    registration: needs.registration === 'essential',
  });
  if (error) throw new ValidationError('The essential arrangements could not be saved.', error.message);

  if (outcome === 'recorded') return needs;
  if (outcome === 'not_found') throw new NotFoundError('Event request');
  if (outcome === 'not_assigned') throw new ForbiddenError('This event is not assigned to you.');

  // The event moved after it was read above, to the status the function returned.
  const status: EventRequestStatus = EventRequestStatusEnum.parse(outcome);
  throw new ConflictError(essentialArrangementsRefusal(status) ?? 'The essential arrangements could not be saved.');
}
