import type { EventRequestStatus } from '@/domain/event-request/schema';

/**
 * SCRUM-91 — the rules, as pure functions, so each one can be tested without a
 * database (docs/architecture.md: policy.ts holds rule functions only).
 */

/**
 * AC1 — "Given my request is in Clarification Requested status". A request in
 * any other status has no open question to answer.
 *
 * Stated as a status rule here and as "is there an open round" in
 * hasOpenRound() below, because the two can disagree in exactly one case worth
 * refusing clearly: a request already resubmitted (Submitted, every round
 * answered) versus one that was never returned at all. Both are refused, and
 * the caller is told which.
 */
export function canRespondToClarification(status: EventRequestStatus): boolean {
  return status === 'clarification_requested';
}

/**
 * An open round is one nobody has answered yet. The database uses the same
 * definition (`response is null`) as the filter on the conditional update, so
 * this check and that write cannot drift apart.
 */
export function hasOpenRound(round: { response: string | null } | null): boolean {
  return round !== null && round.response === null;
}

/**
 * AC3 — "both rounds are listed in order".
 *
 * Ordering is by round_number, not requested_at: the number records which
 * clarification came first, which is a fact about the exchange. Two rounds
 * raised in the same millisecond would still be round 1 and round 2, whereas
 * timestamps would leave their order to chance.
 */
export function sortRoundsInOrder<T extends { roundNumber: number }>(rounds: readonly T[]): T[] {
  return [...rounds].sort((a, b) => a.roundNumber - b.roundNumber);
}
