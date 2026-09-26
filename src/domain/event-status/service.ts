import { fetchEventRequestById, markEventRequestStatus, type EventRequestRow } from '@/lib/supabase/eventRequests';
import { InvalidTransitionError, NotFoundError, ValidationError } from '@/domain/shared/errors';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import { EventRequestIdSchema } from '@/domain/review/schema';
import { canTransition } from './policy';

/**
 * SCRUM-103 — Prevent invalid status transitions.
 *
 * The one way to move an event to a new status in Sprint 2. Orchestration
 * only: the rule is canTransition (policy.ts), the query is
 * markEventRequestStatus (lib/supabase/eventRequests.ts).
 *
 * Who may make a move is not checked here. That belongs to the action making
 * it - SCRUM-101's "raise a booking request" is a coordinator's, for example -
 * and each action checks its own caller before calling this. This story's ACs
 * say "any user": the move is refused whoever asks, so there is nothing about
 * the caller to know.
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
