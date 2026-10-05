import { EventRequestIdSchema } from './schema';
import { canEnterPlanning, canTransition } from './policy';
import { fetchEventRequestById, markEventRequestPlanning, markEventRequestStatus } from '@/lib/supabase/eventRequests';
import type { EventRequestRow } from '@/lib/supabase/eventRequests';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import { NotFoundError, ValidationError, InvalidTransitionError } from '@/domain/shared/errors';

export interface PlanningOutcome {
  id: string;
  status: EventRequestStatus;
}

/**
 * SCRUM-101 AC3/AC4 — Approved -> Planning, when the first venue booking
 * request or equipment request is raised against the event.
 *
 * DUMMY(SCRUM-142) D-09: this function is real and integration-tested, but
 * nothing calls it automatically yet — SCRUM-142's `venue_booking_request`
 * table doesn't exist on this branch or on main. The intended connection is
 * a database trigger on that table (after insert), owned by this ticket's
 * own follow-up migration once the table exists, the same pattern as
 * `set_decided_at`/`set_clarification_requested_at` elsewhere in this
 * codebase — not SCRUM-142's application code calling this directly, which
 * would make that ticket depend on this one existing. See docs/dummies.md.
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

  if (!canTransition(from, to)) {
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
