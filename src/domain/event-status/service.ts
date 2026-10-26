import { EventRequestIdSchema } from './schema';
import {
  NOT_ENDED_YET,
  canBeCompleted,
  canBeConfirmed,
  canEnterPlanning,
  canTransition,
  completionStatusRefusal,
  confirmationStatusRefusal,
  needsSafetyApproval,
} from './policy';
import { fetchEventRequestById, markEventRequestPlanning, markEventRequestStatus } from '@/lib/supabase/eventRequests';
import { fetchEventCompletion, fetchEventEndDate, markEventCompleted, runCompletionCheck } from '@/lib/supabase/eventCompletion';
import { fetchProfileNames } from '@/lib/supabase/profiles';
import { toSingaporeISODate, type ISODate } from '@/domain/shared/dates';
import type { EventRequestRow } from '@/lib/supabase/eventRequests';
import { fetchEventBookingRequests, type EventBookingRequestRow } from '@/lib/supabase/venueBookingRequests';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import type { Role } from '@/domain/identity/roles';
import { isCurrentCoordinator } from '@/domain/assignment/policy';
import { listAffectedBookings } from '@/domain/availability/service';
import { listEventReservations } from '@/domain/equipment-reservation/service';
import {
  confirmationRefusal,
  outstandingEssentialArrangements,
  outstandingReviewArrangements,
} from '@/domain/essential-arrangements/policy';
import { getEssentialArrangements } from '@/domain/essential-arrangements/service';
import { notifyBestEffort } from '@/domain/notification/service';
import { listEventArrangements } from '@/domain/significant-change/service';
import { fromDatabaseTime } from '@/domain/shared/times';
import { VenueBookingRequestLineStatusEnum } from '@/domain/venue-booking/schema';
import { listEventVenueBookings } from '@/domain/venue-booking/service';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  InvalidTransitionError,
} from '@/domain/shared/errors';

export interface PlanningOutcome {
  id: string;
  status: EventRequestStatus;
}

/**
 * SCRUM-101 AC3/AC4 — Approved -> Planning, when the first venue booking
 * request is raised against the event.
 *
 * In the running app this move is made by the database, not by calling this:
 * the trigger on `venue_booking_request`
 * (20261006100000_event_request_enter_planning_on_booking_request.sql) moves
 * an Approved event to Planning in the same transaction as the request that
 * causes it, so SCRUM-142's code does not need to know this ticket exists.
 * This function is the same rule as a direct call - used by tests to bring an
 * event to Planning, and by any later story that needs the move without a
 * booking request.
 *
 * AC4's idempotency is handled here, not by the database filter alone: if
 * the event is already in Planning when this is called (a further request
 * raised against it), that is success, not a duplicate transition to
 * refuse — so the current row is read first, and a write is only ever
 * attempted from 'approved'.
 */
export async function enterPlanning(eventRequestId: string): Promise<PlanningOutcome> {
  const parsedId = EventRequestIdSchema.safeParse(eventRequestId);
  if (!parsedId.success) throw new NotFoundError('Event request');

  const { data: existing, error: readError } = await fetchEventRequestById(parsedId.data);
  if (readError) {
    throw new ValidationError('The event request could not be read.', readError.message);
  }
  if (!existing) throw new NotFoundError('Event request');

  const event = existing as unknown as EventRequestRow;

  // AC4 — already there is success, not a duplicate transition to refuse.
  if (event.status === 'planning') {
    return { id: event.id, status: event.status };
  }

  if (!canEnterPlanning(event.status)) {
    throw new InvalidTransitionError(event.status, 'planning');
  }

  const { data: updated, error: writeError } = await markEventRequestPlanning(parsedId.data);
  if (writeError) {
    throw new ValidationError('The event could not be moved to planning.', writeError.message);
  }
  // The checks above saw an approved event, yet no row matched the filter.
  // Something changed it in between (e.g. it was rejected or cancelled) —
  // re-read to say what, the same race-handling pattern as
  // approveEventRequest's approvalRaceError.
  if (!updated) {
    const { data: current } = await fetchEventRequestById(parsedId.data);
    const currentStatus = (current as unknown as EventRequestRow | null)?.status ?? event.status;
    throw new InvalidTransitionError(currentStatus, 'planning');
  }

  const row = updated as unknown as EventRequestRow;
  return { id: row.id, status: row.status };
}

/**
 * SCRUM-103 — Prevent invalid status transitions.
 *
 * Moves an event to a new status if the lifecycle allows it. Orchestration
 * only: the rule is canTransition (policy.ts), the query is
 * markEventRequestStatus (lib/supabase/eventRequests.ts).
 *
 * It checks only that the move is in the lifecycle. Who may make the move, and
 * anything that must be true first, belongs to the action making it -
 * SCRUM-101's "raise a booking request" is a coordinator's, for example - and
 * each action checks those before calling this. This story's ACs say "any
 * user": the move is refused whoever asks, so there is nothing about the
 * caller to know.
 *
 * The Sprint 1 actions (submit, approve, reject, clarify, resubmit) do not call
 * this: they write their own status through their own guarded updates, which
 * also record what goes with it (a decision, a note, a submission time).
 *
 * No API route calls this. SCRUM-101's story is that nobody maintains status
 * by hand, so a "set status" endpoint would be the wrong thing to build; the
 * actions that cause a move call this function instead.
 *
 * Returns the new status. Throws InvalidTransitionError, leaving the stored
 * status unchanged, when the move is not allowed (AC1-AC3).
 */
export async function changeEventStatus(eventRequestId: string, to: EventRequestStatus): Promise<EventRequestStatus> {
  const parsedId = EventRequestIdSchema.safeParse(eventRequestId);
  if (!parsedId.success) throw new NotFoundError('Event request');

  const { data: existing, error: readError } = await fetchEventRequestById(parsedId.data);
  if (readError) {
    throw new ValidationError('The event request could not be read.', readError.message);
  }
  if (!existing) throw new NotFoundError('Event request');

  const from = (existing as unknown as EventRequestRow).status;

  // SCRUM-234 AC5: Preparation only through the Safety Officer's approval
  // (domain/safety-check/service.ts), never as a plain status change.
  if (!canTransition(from, to) || needsSafetyApproval(to)) {
    throw new InvalidTransitionError(from, to);
  }

  const { data, error } = await markEventRequestStatus(parsedId.data, from, to);
  if (error) {
    throw new ValidationError('The event status could not be changed.', error.message);
  }
  // The move was allowed from the status we read, but the row is no longer in
  // it: something else moved the event in between. Refused rather than
  // re-checked, so the caller sees the conflict instead of a move it never
  // asked for.
  if (!data) throw new InvalidTransitionError(from, to);

  return to;
}

/** Whoever is signed in, passed in by the route from getCurrentActor. */
type Actor = { userId: string; roles: readonly Role[] };

export interface ConfirmationOutcome {
  id: string;
  status: EventRequestStatus;
}

/** Every booking request line of the event, with its venue and status. */
async function readVenueLines(eventRequestId: string) {
  const { data, error } = await fetchEventBookingRequests(eventRequestId);
  if (error || !data) throw new ValidationError("Could not read the event's booking requests.", error?.message);

  return (data as unknown as EventBookingRequestRow[]).flatMap((request) =>
    request.venue_booking_request_line.map((line) => ({
      venueName: request.venues?.name ?? 'Unknown venue',
      date: line.date,
      startTime: fromDatabaseTime(line.start_time),
      endTime: fromDatabaseTime(line.end_time),
      status: VenueBookingRequestLineStatusEnum.parse(line.status),
    })),
  );
}

/**
 * SCRUM-102 — Block confirmation until essential arrangements are complete.
 *
 * The event's assigned coordinator confirms it (TC-102-17), from Planning only
 * (TC-102-16). Refused while an essential arrangement is outstanding, naming
 * every one (AC1, AC2; outstandingEssentialArrangements); confirmed otherwise
 * (AC3 to AC5). Confirming closes nothing: a Pending line, a line still to
 * reserve or an affected booking that is not essential stays open (AC5).
 *
 * Checked in the same order as recordEssentialArrangements (SCRUM-100): the
 * coordinator first, so someone the event is not assigned to learns nothing
 * more about it, then the status, then the arrangements.
 *
 * The check and the move are separate statements. changeEventStatus moves the
 * event only if it is still in Planning, so a confirmation never lands on an
 * event cancelled or confirmed in between, but a booking released in that same
 * instant is not seen. A database function holding a lock would not close
 * that: releasing a booking (SCRUM-231) and marking a period unavailable
 * (SCRUM-151) do not lock the event.
 *
 * AC6: the Event Organiser is told, best effort like SCRUM-198's
 * notifications: one that fails is logged and never undoes the confirmation.
 */
export async function confirmEvent(eventRequestId: string, actor: Actor): Promise<ConfirmationOutcome> {
  const parsedId = EventRequestIdSchema.safeParse(eventRequestId);
  if (!parsedId.success) throw new NotFoundError('Event request');

  const { data, error } = await fetchEventRequestById(parsedId.data);
  if (error) throw new ValidationError('The event request could not be read.', error.message);
  if (!data) throw new NotFoundError('Event request');
  const event = data as unknown as EventRequestRow;

  if (!isCurrentCoordinator(event.coordinator_id, actor.userId)) {
    throw new ForbiddenError('This event is not assigned to you.');
  }
  if (!canBeConfirmed(event.status)) throw new ConflictError(confirmationStatusRefusal(event.status));

  const [essential, venueLines, venueBookings, affectedBookings, equipment, arrangements] = await Promise.all([
    getEssentialArrangements(event.id, actor.userId),
    readVenueLines(event.id),
    listEventVenueBookings(event.id, actor.userId),
    listAffectedBookings(event.id),
    listEventReservations(event.id, actor),
    listEventArrangements(event.id),
  ]);
  const outstanding = outstandingEssentialArrangements({
    needs: essential.needs,
    venueLines,
    venueBookings,
    affectedBookings,
    equipment,
  });
  // SCRUM-190 AC2/AC3: a flagged-for-review arrangement (SCRUM-111) blocks
  // re-confirmation only while it is also marked essential.
  outstanding.push(
    ...outstandingReviewArrangements(essential.needs, {
      bookings: arrangements.bookings.filter((item) => item.reviewRequired).map((item) => item.label),
      reservations: arrangements.reservations.filter((item) => item.reviewRequired).map((item) => item.label),
    }),
  );
  if (outstanding.length > 0) throw new ConflictError(confirmationRefusal(outstanding), { outstanding });

  await changeEventStatus(event.id, 'confirmed');

  await notifyBestEffort({
    recipientId: event.organiser_id,
    type: 'event_confirmed',
    eventRequestId: event.id,
    message: `${event.reference} (${event.name}) is confirmed.`,
  });

  return { id: event.id, status: 'confirmed' };
}

export interface EventCompletion {
  /** The last day of the event's confirmed bookings, else its proposed date; null with neither. */
  endDate: ISODate | null;
  /** AC1, AC2: the Singapore date it was completed, and by whom; byName null is the completion check. */
  completed: { on: ISODate; byName: string | null } | null;
}

/**
 * SCRUM-104 — what the event page needs: the end date, to decide whether to
 * offer Mark as completed (AC4), and who completed it and when (AC1, AC2).
 * The page has already checked the actor may see the event.
 */
export async function getEventCompletion(eventRequestId: string): Promise<EventCompletion> {
  const [endDate, completion] = await Promise.all([fetchEventEndDate(eventRequestId), fetchEventCompletion(eventRequestId)]);
  if (endDate.error) throw new ValidationError("The event's end date could not be read.", endDate.error.message);
  if (completion.error) throw new ValidationError("The event's completion could not be read.", completion.error.message);

  const completedAt = completion.data?.completed_at ?? null;
  const completedBy = completion.data?.completed_by ?? null;
  let byName: string | null = null;
  if (completedBy !== null) {
    const { data } = await fetchProfileNames([completedBy]);
    const name = data?.[0]?.full_name;
    byName = name && name.trim() !== '' ? name : 'An unnamed account';
  }

  return {
    endDate: endDate.data ?? null,
    completed: completedAt === null ? null : { on: toSingaporeISODate(new Date(completedAt)), byName },
  };
}

export interface CompletionOutcome {
  id: string;
  status: EventRequestStatus;
}

/**
 * SCRUM-104 AC1, AC4, AC5 — the event's assigned coordinator marks it
 * completed (TC-104-09), from Preparation only (AC5), once its end date has
 * passed (AC4). The time and the coordinator are recorded (AC1).
 *
 * Checked in the same order as confirmEvent: the coordinator first, then the
 * status. The end date is checked by complete_event itself, with the event
 * locked, so the completion check running at the same moment cannot complete
 * it twice.
 */
export async function completeEvent(eventRequestId: string, actor: Actor): Promise<CompletionOutcome> {
  const parsedId = EventRequestIdSchema.safeParse(eventRequestId);
  if (!parsedId.success) throw new NotFoundError('Event request');

  const { data, error } = await fetchEventRequestById(parsedId.data);
  if (error) throw new ValidationError('The event request could not be read.', error.message);
  if (!data) throw new NotFoundError('Event request');
  const event = data as unknown as EventRequestRow;

  if (!isCurrentCoordinator(event.coordinator_id, actor.userId)) {
    throw new ForbiddenError('This event is not assigned to you.');
  }
  if (!canBeCompleted(event.status)) throw new ConflictError(completionStatusRefusal(event.status));

  const { data: outcome, error: writeError } = await markEventCompleted(event.id, actor.userId);
  if (writeError) throw new ValidationError('The event could not be marked completed.', writeError.message);
  if (outcome === 'not_ended') throw new ConflictError(NOT_ENDED_YET);
  // It left Preparation between the read above and the lock.
  if (outcome !== 'completed') throw new ConflictError('This event is no longer in Preparation. Reload the page.');

  return { id: event.id, status: 'completed' };
}

/**
 * SCRUM-104 AC2, AC3 — run the completion check once, as pg_cron does daily.
 * The check itself is complete_past_events, so the timer and the rule live in
 * one place; this is for tests and the seed's completion-check. Resolves to
 * how many events it completed.
 */
export async function completePastEvents(today?: ISODate): Promise<number> {
  const { data, error } = await runCompletionCheck(today);
  if (error || data === null) throw new ValidationError('The completion check could not run.', error?.message);
  return data;
}
