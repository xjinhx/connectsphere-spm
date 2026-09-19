import { createAdminClient } from './admin';

// ---------------------------------------------------------------------------
// SCRUM-91 — Respond to a clarification request
// ---------------------------------------------------------------------------
// Per docs/architecture.md (rule 3), both the Supabase client and the query
// live here, so domain/clarification/service.ts never holds a client.

const COLUMNS =
  'id, event_request_id, round_number, note, requested_by, requested_at, response, responded_by, responded_at';

export interface ClarificationRoundRow {
  id: string;
  event_request_id: string;
  round_number: number;
  note: string;
  requested_by: string;
  requested_at: string;
  response: string | null;
  responded_by: string | null;
  responded_at: string | null;
}

/**
 * AC3 — "both rounds are listed in order". Ordered by round_number, the column
 * that records which came first, rather than by requested_at: two rounds are
 * ordered by the sequence of the exchange, not by clock precision.
 */
export async function listClarificationRounds(eventRequestId: string) {
  return createAdminClient()
    .from('event_request_clarification_round')
    .select(COLUMNS)
    .eq('event_request_id', eventRequestId)
    .order('round_number', { ascending: true });
}

/**
 * The round still waiting for an answer, if there is one. An open round is
 * exactly `response is null` — the same definition the conditional update
 * below filters on, so the check and the write cannot disagree about it.
 */
export async function fetchOpenClarificationRound(eventRequestId: string) {
  return createAdminClient()
    .from('event_request_clarification_round')
    .select(COLUMNS)
    .eq('event_request_id', eventRequestId)
    .is('response', null)
    .maybeSingle();
}

/**
 * AC1/AC2 — record the Organiser's answer against the round it answers.
 *
 * `.is('response', null)` is what makes a double answer impossible: if two
 * resubmits arrive at once, the second matches no row and gets back null,
 * which the service turns into a conflict rather than a second write. The same
 * guard pattern as assignCoordinatorToEventRequest (SCRUM-94) and
 * markEventRequestSubmitted (SCRUM-82).
 *
 * responded_at is deliberately absent: the database stamps it
 * (set_clarification_responded_at).
 */
export async function recordClarificationResponse(
  roundId: string,
  response: string,
  actorId: string,
) {
  return createAdminClient()
    .from('event_request_clarification_round')
    .update({ response, responded_by: actorId })
    .eq('id', roundId)
    .is('response', null)
    .select(COLUMNS)
    .maybeSingle();
}
