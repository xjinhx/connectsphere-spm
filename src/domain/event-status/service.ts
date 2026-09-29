import { EventRequestIdSchema } from './schema';
import { canEnterPlanning } from './policy';
import { fetchEventRequestById, markEventRequestPlanning } from '@/lib/supabase/eventRequests';
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
