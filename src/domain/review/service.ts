import {
  fetchEventRequestById,
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
import {
  COMMITMENT_STATEMENT,
  NO_COMMITMENTS,
  canBeApproved,
  type Commitments,
} from './policy';

/**
 * SCRUM-92 — Approve a request so planning can proceed.
 *
 * Orchestration only: validates the input, applies the rules from policy.ts,
 * and calls functions in src/lib/supabase/eventRequests.ts. Per
 * docs/architecture.md (rule 3) it never imports a Supabase client or builds a
 * query itself.
 */

// ---------------------------------------------------------------------------
// AC1 — approve
// ---------------------------------------------------------------------------

/**
 * What AC1 records. Deliberately smaller than event-request's EventRequest:
 * approving reports the decision, not the whole request.
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
 * TODO: actorId is taken from the caller until getCurrentActor() is implemented
 * on main (see ApproveInputSchema). Once it is, the route should read the
 * coordinator from the session and pass actor.userId in; this function's
 * signature does not need to change.
 */
export async function approveEventRequest(id: string, input: unknown): Promise<ApprovalOutcome> {
  const parsedId = EventRequestIdSchema.safeParse(id);
  if (!parsedId.success) throw new NotFoundError('Event request');

  const parsedInput = ApproveInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new ValidationError('The approval is not valid.', parsedInput.error.flatten());
  }

  const { data: existing, error: readError } = await fetchEventRequestById(parsedId.data);
  if (readError) {
    throw new ValidationError('The event request could not be read.', readError.message);
  }
  if (!existing) throw new NotFoundError('Event request');

  const current = existing as unknown as EventRequestRow;
  if (!canBeApproved(current.status)) {
    throw new InvalidTransitionError(current.status, 'approved');
  }

  const { data, error } = await markEventRequestApproved(parsedId.data, parsedInput.data.actorId);
  if (error) {
    throw new ValidationError('The event request could not be approved.', error.message);
  }
  // The check above saw a submitted request, yet no row matched the
  // `status = submitted` filter: another coordinator approved it in between.
  // The filter is what makes that safe; this turns it into an answer for
  // whoever came second, rather than a silent no-op.
  if (!data) throw new InvalidTransitionError('approved', 'approved');

  return toApprovalOutcome(data as unknown as EventRequestRow);
}

// ---------------------------------------------------------------------------
// AC2 / AC3 — view the approval
// ---------------------------------------------------------------------------

/**
 * What anyone viewing a request is told about its approval.
 *
 * AC2 asks for "the approval outcome and date" and the statement - not who made
 * the decision - so decided_by is deliberately left out of a view that any
 * signed-in user can read.
 */
export interface ApprovalView {
  id: string;
  status: EventRequestStatus;
  /** The approval outcome. Null until the request has been decided. */
  decision: Decision | null;
  /** The approval date: an instant stamped by the database, or null. */
  decidedAt: string | null;
  commitments: Commitments;
  commitmentStatement: string;
}

/**
 * AC2 — the organiser sees the outcome and date with the statement that nothing
 * is yet committed.
 * AC3 — anyone viewing an approved request sees it is not confirmed, and that
 * no venue or equipment is committed.
 *
 * Who may view: Jira AC3 says "anyone", so there is no ownership or role check
 * here; the middleware already refuses the route without a signed-in session.
 * This is a separate read from event-request's getEventRequest, whose rule is
 * that only the owning organiser may read a request - widening that rule would
 * mean changing SCRUM-82's logic from this story.
 *
 * The commitment flags and statement are returned for every request, decided
 * or not, because this sprint nothing can be committed against any request.
 */
export async function getApprovalView(id: string): Promise<ApprovalView> {
  const parsedId = EventRequestIdSchema.safeParse(id);
  if (!parsedId.success) throw new NotFoundError('Event request');

  const { data, error } = await fetchEventRequestById(parsedId.data);
  if (error) {
    throw new ValidationError('The event request could not be read.', error.message);
  }
  if (!data) throw new NotFoundError('Event request');

  const row = data as unknown as EventRequestRow;
  return {
    id: row.id,
    status: row.status,
    decision: row.decision,
    decidedAt: row.decided_at,
    commitments: { ...NO_COMMITMENTS },
    commitmentStatement: COMMITMENT_STATEMENT,
  };
}
