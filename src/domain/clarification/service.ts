import {
  fetchOpenClarificationRound,
  listClarificationRounds,
  recordClarificationResponse,
  type ClarificationRoundRow,
} from '@/lib/supabase/clarificationRounds';
import { fetchEventRequestById, type EventRequestRow } from '@/lib/supabase/eventRequests';
import { submitEventRequest } from '@/domain/event-request/service';
import { isOwnRequest } from '@/domain/event-request/policy';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import {
  ConflictError,
  ForbiddenError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
} from '@/domain/shared/errors';
import { ClarificationResponseInputSchema, EventRequestIdSchema } from './schema';
import { canRespondToClarification, hasOpenRound, sortRoundsInOrder } from './policy';

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
 * ORDER, and the one window it leaves open. Two writes are needed — close the
 * round, and flip the status — and supabase-js has no transactions, so they
 * cannot be made atomic from here.
 *
 *   - Submit first, then close the round (chosen). If the close fails, the
 *     request is Submitted with its last round unanswered: the Coordinator sees
 *     a question with no reply and can ask again. Nothing is lost and nothing
 *     is wrong, it is just incomplete.
 *   - Close the round first, then submit (rejected). If the submit is refused —
 *     and SCRUM-82 AC2 refuses any request with an incomplete mandatory field,
 *     which is a *likely* outcome, not a rare one — the answer is recorded
 *     against a request still sitting in Clarification Requested. The round is
 *     now closed, so the Organiser's next attempt would be told there is
 *     nothing to respond to, locking them out of their own request.
 *
 * The chosen order fails only on a database error; the rejected one fails on an
 * ordinary user mistake.
 *
 * DUMMY(SCRUM-24) D-07: AC1 also says the assigned coordinator is notified. The
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

  // Status first (see ORDER above). Refuses an incomplete request, someone
  // else's request, and a request another call has already resubmitted.
  let submitted;
  try {
    submitted = await submitEventRequest(parsedId.data);
  } catch (error) {
    // The status was clarification_requested a moment ago, so the only way
    // SCRUM-82 can refuse the transition now is that another resubmit won the
    // race. Its own message for that case reads "An event cannot move from
    // submitted to submitted", which is true of its story and meaningless in
    // this one. Every other refusal it raises - an incomplete field, a request
    // that is not yours - is left exactly as it is.
    if (error instanceof InvalidTransitionError) {
      throw new ConflictError('This request has already been resubmitted.');
    }
    throw error;
  }

  const { data, error } = await recordClarificationResponse(open.id, response, actorId);
  if (error) {
    throw new ValidationError('The response could not be saved.', error.message);
  }
  // The round was open a moment ago and no row matched: another resubmit
  // answered it in between. Only one of them can have flipped the status, so
  // this is the loser of that race.
  if (!data) {
    throw new ConflictError('This clarification has already been answered.');
  }

  return {
    id: submitted.id,
    status: submitted.status,
    round: toRound(data as unknown as ClarificationRoundRow),
    coordinatorId: existing.coordinator_id,
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
 * Who may read: anyone signed in, matching SCRUM-90's getClarificationView. The
 * Jira wording is "the coordinator opens the request", but the coordinator is
 * not the only person entitled to see the exchange — the organiser wrote half
 * of it — and the middleware already refuses this without a session.
 */
export async function getClarificationExchange(id: string): Promise<ClarificationExchange> {
  const parsedId = EventRequestIdSchema.safeParse(id);
  if (!parsedId.success) throw new NotFoundError('Event request');

  const request = await readRequest(parsedId.data);

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
