import {
  fetchOpenClarificationRound,
  listClarificationRounds,
  recordClarificationResponse,
  type ClarificationRoundRow,
} from '@/lib/supabase/clarificationRounds';
import { fetchEventRequestById, type EventRequestRow } from '@/lib/supabase/eventRequests';
import { incompleteFields, isOwnRequest } from '@/domain/event-request/policy';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import type { Role } from '@/domain/identity/roles';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/domain/shared/errors';
import { ClarificationResponseInputSchema, EventRequestIdSchema } from './schema';
import {
  canRespondToClarification,
  canViewClarificationExchange,
  hasOpenRound,
  sortRoundsInOrder,
} from './policy';

/**
 * SCRUM-91 — Respond to a clarification request.
 *
 * Orchestration only: validates the input, applies the rules from policy.ts,
 * and calls functions in src/lib/supabase/. Per docs/architecture.md (rule 3)
 * it never imports a Supabase client or builds a query itself.
 */

// ---------------------------------------------------------------------------
// Shared shape
// ---------------------------------------------------------------------------

/** One round of the exchange: what was asked, and what was answered. */
export interface ClarificationRound {
  roundNumber: number;
  note: string;
  requestedAt: string;
  /** Null while the round is still open — nobody has answered it yet. */
  response: string | null;
  respondedAt: string | null;
}

function toRound(row: ClarificationRoundRow): ClarificationRound {
  return {
    roundNumber: row.round_number,
    note: row.note,
    requestedAt: row.requested_at,
    response: row.response,
    respondedAt: row.responded_at,
  };
}

async function readRequest(id: string): Promise<EventRequestRow> {
  const { data, error } = await fetchEventRequestById(id);
  if (error) throw new ValidationError('The event request could not be read.', error.message);
  if (!data) throw new NotFoundError('Event request');
  return data as unknown as EventRequestRow;
}

// ---------------------------------------------------------------------------
// AC1 — amend, respond, and send it back
// ---------------------------------------------------------------------------

export interface ClarificationResponseOutcome {
  id: string;
  /** Back to 'submitted' — the half of AC1 the existing submit path performs. */
  status: EventRequestStatus;
  round: ClarificationRound;
  /** AC1's "the assigned coordinator is notified" — see the DUMMY note below. */
  coordinatorId: string | null;
}

/**
 * AC1 — "Given my request is in Clarification Requested status, when I amend it
 * and resubmit, then its status returns to Submitted and the assigned
 * coordinator is notified."
 *
 * The amendment itself is not performed here: a request in Clarification
 * Requested is already editable (isEditable, SCRUM-90 AC2) and saves through
 * SCRUM-83's draft PATCH. This is the resubmission, carrying the answer.
 *
 * The status change is delegated to submitEventRequest (SCRUM-82) rather than
 * written again here. That function already enforces the organiser role, that
 * the request is the caller's own, that the status allows it, and that no
 * mandatory field is incomplete (SCRUM-82 AC2). Re-implementing those checks
 * would be a second opinion about another story's rules that could drift from
 * it; calling it is reuse, not a change to their story.
 *
 * ONE WRITE, not two. Closing the round is what returns the request to
 * Submitted: the database does the status change inside the same statement
 * (resubmit_on_clarification_response). supabase-js has no transactions, so any
 * version of this that wrote twice had a window between them, and both orders
 * were wrong in a way that mattered:
 *
 *   - Close the round, then submit. SCRUM-82 AC2 refuses a request with an
 *     incomplete mandatory field, which is an ordinary mistake rather than a
 *     rare fault. The answer would be recorded against a request still sitting
 *     in Clarification Requested, and the Organiser's next attempt would be told
 *     there is nothing to respond to - locked out of their own request.
 *   - Submit, then close the round (what this did first). If the close failed,
 *     the request was Submitted with its round still open. The Coordinator could
 *     then raise another, leaving two unanswered rounds - and "which round is
 *     open" matches two rows and fails, so every later response to that request
 *     failed too, permanently. Found in review, reproduced, and the reason this
 *     is now a single write.
 *
 * Completeness is still SCRUM-82's rule: incompleteFields is applied below,
 * before anything is written, so an incomplete request is refused with every
 * field named and the round stays open for another attempt. The rule is reused;
 * only the write is no longer routed through submitEventRequest, because that
 * function performs the status change this one has to make atomic.
 *
 * DUMMY(SCRUM-24) D-08: AC1 also says the assigned coordinator is notified. The
 * Notification System (SCRUM-24) is not in this sprint, so nothing is sent: the
 * recorded answer against the event the coordinator already owns is the minimum
 * honest implementation, and coordinatorId is returned so the caller can see
 * who would have been told. When SCRUM-24 lands, raise the notification from
 * here — the round has just been closed and the coordinator's id is to hand.
 * See docs/dummies.md.
 */
export async function respondToClarification(
  eventRequestId: string,
  input: unknown,
  actorId: string,
): Promise<ClarificationResponseOutcome> {
  const parsedId = EventRequestIdSchema.safeParse(eventRequestId);
  if (!parsedId.success) throw new NotFoundError('Event request');

  const parsedInput = ClarificationResponseInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new ValidationError('The response is not valid.', parsedInput.error.flatten());
  }
  const { response } = parsedInput.data;

  const existing = await readRequest(parsedId.data);

  // Checked here as well as inside submitEventRequest, because a stranger
  // should be refused before being told anything about the request — including
  // whether it has a clarification open on it.
  if (!isOwnRequest({ organiserId: existing.organiser_id }, actorId)) {
    throw new ForbiddenError('This event request belongs to another organiser.');
  }

  // Both of the next two checks mean the same thing to whoever is asking -
  // there is nothing here to answer - so they say the same thing. An
  // InvalidTransitionError was tried first and read as "An event cannot move
  // from submitted to clarification_requested", which describes neither what
  // the caller asked for nor what happened: they asked to answer a question,
  // not to move a request backwards. The same lesson SCRUM-90 recorded when it
  // changed a lost clarification race to a conflict (commit a3391f1).
  const nothingToAnswer = new ConflictError(
    'There is no clarification waiting for a response on this request.',
  );

  if (!canRespondToClarification(existing.status)) throw nothingToAnswer;

  const { data: openRow, error: openError } = await fetchOpenClarificationRound(parsedId.data);
  if (openError) {
    throw new ValidationError('The clarification could not be read.', openError.message);
  }
  const open = (openRow as unknown as ClarificationRoundRow | null) ?? null;
  if (!hasOpenRound(open) || open === null) throw nothingToAnswer;

  // SCRUM-82 AC2 applies to a resubmission too: a request missing a mandatory
  // field cannot go back for review. Their rule, called here rather than
  // restated, so the two can never disagree about what "complete" means.
  const incomplete = incompleteFields({
    name: existing.name,
    purpose: existing.purpose,
    description: existing.description,
    proposedDate: existing.proposed_date,
    timeSlots: existing.time_slots,
    expectedAttendance: existing.expected_attendance,
  });
  if (incomplete.length > 0) {
    throw new ValidationError(
      'The request cannot be resubmitted until every mandatory field is complete.',
      { incompleteFields: incomplete },
    );
  }

  // The one write. Closing the round returns the request to Submitted, in the
  // same statement (see ONE WRITE above).
  const { data, error } = await recordClarificationResponse(open.id, response, actorId);
  if (error) {
    throw new ValidationError('The response could not be saved.', error.message);
  }
  // The round was open a moment ago and no row matched: another resubmit
  // answered it in between. Only one of them can have closed it, so this is the
  // loser of that race.
  if (!data) {
    throw new ConflictError('This clarification has already been answered.');
  }

  // Read back rather than assumed: the status was changed by the database, and
  // reporting what it actually says is the point of doing it there.
  const updated = await readRequest(parsedId.data);

  return {
    id: updated.id,
    status: updated.status,
    round: toRound(data as unknown as ClarificationRoundRow),
    coordinatorId: updated.coordinator_id,
  };
}

// ---------------------------------------------------------------------------
// AC2 / AC3 — what the coordinator reads afterwards
// ---------------------------------------------------------------------------

export interface ClarificationExchange {
  id: string;
  status: EventRequestStatus;
  /** AC3 — oldest first. */
  rounds: ClarificationRound[];
}

/**
 * AC2 — "the original clarification note, my response and my amended values are
 * all retained with the event record."
 *
 * Two of the three are here: every round keeps the note it was raised with and
 * the answer it received, and neither is overwritten by a later round. The
 * amended values are the event request's own columns, read through the existing
 * request/review reads (SCRUM-89) — deliberately not copied into this response,
 * because a second copy of the event's fields could drift from the record it
 * claims to be showing. "Retained" means nothing was lost, not that one
 * endpoint has to return everything.
 *
 * AC3 — "both rounds are listed in order."
 *
 * Who may read: the organiser who owns the request, its current coordinator, and
 * the Event Operations Managers who assign coordinators — canViewClarificationExchange.
 *
 * Narrower than "anyone signed in", which is what this did first and what
 * SCRUM-90's getClarificationView still does. Raised in review: the rounds carry
 * the free text of a discussion about an event, and a signed-in stranger with an
 * id has no business reading it. The same is true of SCRUM-90's route, which
 * returns the note's text as well — reported as a bug against that story rather
 * than changed from here.
 */
export async function getClarificationExchange(
  id: string,
  actor: { userId: string; roles: readonly Role[] },
): Promise<ClarificationExchange> {
  const parsedId = EventRequestIdSchema.safeParse(id);
  if (!parsedId.success) throw new NotFoundError('Event request');

  const request = await readRequest(parsedId.data);

  if (
    !canViewClarificationExchange(
      { organiserId: request.organiser_id, coordinatorId: request.coordinator_id },
      actor,
    )
  ) {
    throw new ForbiddenError('This clarification exchange is not yours to read.');
  }

  const { data, error } = await listClarificationRounds(parsedId.data);
  if (error) {
    throw new ValidationError('The clarification rounds could not be read.', error.message);
  }

  const rows = (data ?? []) as unknown as ClarificationRoundRow[];
  return {
    id: request.id,
    status: request.status,
    // The query already orders by round_number; sorted again here so the rule
    // is stated in policy.ts and tested there, rather than living only in a
    // query nobody reads.
    rounds: sortRoundsInOrder(rows.map(toRound)),
  };
}
