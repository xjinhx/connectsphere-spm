import { createAdminClient } from '@/lib/supabase/admin';
import {
  fetchEventRequest,
  markEventRequestApproved,
  type EventRequestRow,
} from '@/lib/supabase/eventRequests';
import {
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
} from '@/domain/shared/errors';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import { ApproveInputSchema, EventRequestIdSchema, type Decision } from './schema';
import { canBeApproved } from './policy';

/**
 * SCRUM-92 — Approve a request so planning can proceed.
 *
 * Orchestration only: validates the input, applies the rule from policy.ts,
 * then delegates every Supabase call to src/lib/supabase/eventRequests.ts.
 */

/**
 * What AC1 records. Deliberately smaller than event-request's EventRequest:
 * approving reports the decision, not the whole request. AC2's read path is
 * where the full request belongs.
 */
export interface ApprovalOutcome {
  id: string;
  status: EventRequestStatus;
  decision: Decision;
  decidedBy: string;
  /** An instant, stamped by the database (see the set_decided_at trigger). */
  decidedAt: string;
}

function toApprovalOutcome(row: EventRequestRow): ApprovalOutcome {
  // The event_request_decision_complete constraint guarantees the three are
  // written together, so this cannot happen for a row that was just approved.
  // Checked rather than asserted, because the alternative is a non-null
  // assertion that would hide a real inconsistency if one ever occurred.
  if (row.decision === null || row.decided_by === null || row.decided_at === null) {
    throw new ValidationError('The approval was recorded incompletely.');
  }

  return {
    id: row.id,
    status: row.status,
    decision: row.decision,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
  };
}

/**
 * AC1 — a submitted request becomes approved, and the decision, the decision
 * maker and the timestamp are recorded against it.
 *
 * Approving commits ConnectSphere to nothing: no venue, equipment or
 * registration record is created here or anywhere else in this story
 * (customer clarification #80).
 *
 * TODO(SCRUM-68): actorId is taken from the caller because getCurrentActor()
 * throws until Authentication lands. Once it does, read the coordinator from
 * the session instead of trusting the request body.
 */
export async function approveEventRequest(id: string, input: unknown): Promise<ApprovalOutcome> {
  const parsedId = EventRequestIdSchema.safeParse(id);
  if (!parsedId.success) throw new NotFoundError('Event request');

  const parsedInput = ApproveInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new ValidationError('The approval is not valid.', parsedInput.error.flatten());
  }

  const supabase = createAdminClient();

  const { data: existing, error: readError } = await fetchEventRequest(supabase, parsedId.data);
  if (readError) {
    throw new ValidationError('The event request could not be read.', readError.message);
  }
  if (!existing) throw new NotFoundError('Event request');

  const current = existing as unknown as EventRequestRow;
  if (!canBeApproved(current.status)) {
    throw new InvalidTransitionError(current.status, 'APPROVED');
  }

  const { data, error } = await markEventRequestApproved(
    supabase,
    parsedId.data,
    parsedInput.data.actorId,
  );
  if (error) {
    throw new ValidationError('The event request could not be approved.', error.message);
  }
  // The check above saw a submitted request, yet no row matched the
  // `status = SUBMITTED` filter: another coordinator approved it in between.
  // The filter is what makes that safe; this turns it into an answer for
  // whoever came second, rather than a silent no-op.
  if (!data) throw new InvalidTransitionError('APPROVED', 'APPROVED');

  return toApprovalOutcome(data as unknown as EventRequestRow);
}
