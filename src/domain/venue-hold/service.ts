import {
  fetchEventNames,
  fetchEventStatus,
  fetchEventsInStatuses,
  fetchUpcomingActiveHolds,
  fetchVenueHoldById,
  insertVenueHold,
  runHoldExpiryCheck,
} from '@/lib/supabase/venueHolds';
import { ConflictError, NotFoundError, ValidationError } from '@/domain/shared/errors';
import { todayInSingapore } from '@/domain/shared/dates';
import { getVenue } from '@/domain/venues/service';
import { getVenueCommitments } from '@/domain/availability/service';
import { canBeHeld, describeCommitmentForHold, futureExpiry, holdState } from './policy';
import {
  CreateVenueHoldInputSchema,
  FUTURE_EXPIRY_REQUIRED,
  HOLDABLE_EVENT_STATUSES,
  HoldableEventSchema,
  VenueHoldSchema,
  type HoldableEvent,
  type VenueHold,
} from './schema';

/**
 * Venue hold service (SCRUM-227 Hold a venue until an expiry).
 *
 * Orchestration only: queries live in src/lib/supabase/venueHolds.ts, the
 * rules in policy.ts, single-field rules in schema.ts. Whether a period is
 * free is asked of getVenueCommitments, the one availability check
 * (src/domain/availability/service.ts), never worked out here.
 *
 * Who may hold is checked by the route and the page (venue_administration,
 * Venue Staff's). The holder recorded is the signed-in account passed in by
 * the route, never an id from the request body.
 */

type HoldRow = {
  id: string;
  venue_id: string;
  event_request_id: string;
  date: string;
  start_time: string;
  end_time: string;
  expires_at: string;
  status: string;
  created_at: string;
  event_request: { reference: string; name: string };
};

function toVenueHold(row: HoldRow, now: Date): VenueHold {
  const expiresAt = new Date(row.expires_at).toISOString();
  return VenueHoldSchema.parse({
    id: row.id,
    venueId: row.venue_id,
    event: { id: row.event_request_id, reference: row.event_request.reference, name: row.event_request.name },
    date: row.date,
    start: row.start_time.slice(0, 5),
    end: row.end_time.slice(0, 5),
    expiresAt,
    state: holdState({ status: row.status, expiresAt }, now),
    createdAt: row.created_at,
  });
}

/** AC2: the expiry field, named, as Zod's flatten() would name it. */
function expiryRequired(): ValidationError {
  return new ValidationError(FUTURE_EXPIRY_REQUIRED, { formErrors: [], fieldErrors: { expiresAt: [FUTURE_EXPIRY_REQUIRED] } });
}

/**
 * SCRUM-227 AC1 and AC2: hold a period at a venue for an event until an
 * expiry.
 *
 * Refused, with nothing recorded:
 * - AC2: an expiry that is missing or not after `now`.
 * - an event that is not Approved or in Planning (canBeHeld), or not there.
 * - a period that already holds a confirmed booking, another active hold or
 *   an unavailable period at this venue: customer #41, one active hold or
 *   booking per overlapping period. The refusal names each one; Venue Staff
 *   may see which event holds it (SCRUM-155 AC1).
 *
 * The overlap is checked here and not locked, the same as SCRUM-154's request
 * check: two holds saved in the same instant could both pass.
 */
export async function createVenueHold(
  venueId: string,
  input: unknown,
  actorId: string,
  now: Date = new Date(),
): Promise<VenueHold> {
  const parsed = CreateVenueHoldInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'The hold is not valid.', parsed.error.flatten());
  }
  const { eventRequestId, date, start, end } = parsed.data;

  const expiry = futureExpiry(parsed.data.expiresAt, now);
  if (!expiry) throw expiryRequired();

  // Throws NotFoundError for a venue that does not exist or a malformed id.
  const venue = await getVenue(venueId);

  const { data: event, error: eventError } = await fetchEventStatus(eventRequestId);
  if (eventError) throw new ValidationError('The event could not be read.', eventError.message);
  if (!event) throw new NotFoundError('Event request');
  if (!canBeHeld(event.status)) {
    throw new ValidationError('Only an approved event, or one in Planning, can be held.', {
      formErrors: [],
      fieldErrors: { eventRequestId: ['Only an approved event, or one in Planning, can be held.'] },
    });
  }

  const committed = await getVenueCommitments(venue.id, `${date}T${start}`, `${date}T${end}`, now);
  if (committed.length > 0) {
    const names = await eventNames(committed.flatMap((c) => (c.eventRequestId ? [c.eventRequestId] : [])));
    const reasons = committed.map((c) => describeCommitmentForHold(c, c.eventRequestId ? (names.get(c.eventRequestId) ?? null) : null));
    throw new ConflictError(`That period cannot be held. ${reasons.join(' ')}`, {
      reason: 'already_committed',
      committed,
    });
  }

  const { data: created, error } = await insertVenueHold({
    venueId: venue.id,
    eventRequestId,
    date,
    start,
    end,
    expiresAt: expiry.toISOString(),
    createdBy: actorId,
  });
  if (error || !created) {
    throw new ValidationError('The hold could not be saved.', error?.message);
  }
  return getVenueHold(created.id, now);
}

/** One hold, as it stands at `now`. */
export async function getVenueHold(holdId: string, now: Date = new Date()): Promise<VenueHold> {
  const { data, error } = await fetchVenueHoldById(holdId);
  if (error) throw new ValidationError('The hold could not be read.', error.message);
  if (!data) throw new NotFoundError('Hold');
  return toVenueHold(data as HoldRow, now);
}

/**
 * The venue page's list for Venue Staff: the venue's holds that are active
 * now, from today on, soonest first. Closed and lapsed holds drop off (AC5,
 * AC6). "Today" is Singapore's date.
 */
export async function listActiveVenueHolds(venueId: string, now: Date = new Date()): Promise<VenueHold[]> {
  const { data, error } = await fetchUpcomingActiveHolds(venueId, todayInSingapore(now), now.toISOString());
  if (error || !data) throw new ValidationError("Could not load the venue's holds.", error?.message);
  return (data as HoldRow[]).map((row) => toVenueHold(row, now));
}

/** The events the hold form offers: Approved or in Planning (canBeHeld). */
export async function listHoldableEvents(): Promise<HoldableEvent[]> {
  const { data, error } = await fetchEventsInStatuses(HOLDABLE_EVENT_STATUSES);
  if (error || !data) throw new ValidationError('Could not load the events.', error?.message);
  return data.map((row) => HoldableEventSchema.parse(row));
}

async function eventNames(ids: readonly string[]): Promise<Map<string, { reference: string; name: string }>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data, error } = await fetchEventNames(unique);
  if (error) throw new ValidationError('Could not read the events holding that period.', error.message);
  return new Map((data ?? []).map((row) => [row.id, { reference: row.reference, name: row.name }]));
}

// -----------------------------------------------------------------------------
// SCRUM-228 Tell the coordinator when a hold is about to expire
// -----------------------------------------------------------------------------

/**
 * SCRUM-228 AC1 and AC2: run the hold-expiry check once, as pg_cron does
 * every 5 minutes. Each active hold's coordinator is warned once when 24 hours
 * or less remain (AC1), and told once when it lapses (AC2); a hold its booking
 * closed is never looked at again (AC3). Resolves to how many notifications
 * were sent.
 *
 * The check itself is the database function notify_hold_expiries
 * (supabase/migrations/20261013010941_...), so the timer and the rule live in
 * one place; this is for tests, and for anything in the app that wants to run
 * it now rather than at the next tick.
 */
export async function sendHoldExpiryNotifications(now?: Date): Promise<number> {
  const { data, error } = await runHoldExpiryCheck(now?.toISOString());
  if (error || data === null) {
    throw new ValidationError('The hold-expiry check could not run.', error?.message);
  }
  return data;
}
