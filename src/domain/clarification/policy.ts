import type { EventRequestStatus } from '@/domain/event-request/schema';
import { isActionPermitted } from '@/domain/identity/permissions';
import type { Role } from '@/domain/identity/roles';

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
 * AC2/AC3 — who may read the exchange.
 *
 * The Jira wording is "when the coordinator opens the request", but a
 * clarification exchange has two authors and the Organiser wrote half of it, so
 * the Coordinator cannot be the only reader. The Event Operations Managers who
 * assign coordinators are included for the same reason they can see an event's
 * assignment history (SCRUM-98): they decide who owns the event, and an
 * unanswered question is part of what they are deciding about.
 *
 * Everyone else is refused, including a coordinator the event has been
 * reassigned away from - SCRUM-96 AC4, "access is denied and no planning
 * information is returned".
 *
 * Deliberately narrower than SCRUM-90's getClarificationView, which any
 * signed-in account can read. That route predates this rule and exposes the
 * note's free text the same way; it is a separate story's code, so it is
 * reported rather than changed here.
 *
 * The same set of people as canViewCoordinatorDetails (SCRUM-98), written out
 * again rather than delegated: that rule answers "who may see who owns this
 * event", this one answers "who may read what was said about it". They agree
 * today, and either could change without the other being wrong.
 */
export function canViewClarificationExchange(
  event: { organiserId: string; coordinatorId: string | null },
  actor: { userId: string; roles: readonly Role[] },
): boolean {
  // Whoever may review this request may read what was said about it.
  // SCRUM-232 AC5: an event with no coordinator yet is no longer included -
  // matching SCRUM-89's canReviewDetail, assignment is now a precondition of
  // review, not an interim state a coordinator can raise or read a
  // clarification on directly. The `coordinator_assignment` branch below
  // still gives the Lead a way to read it.
  const mayReview =
    isActionPermitted(actor.roles, 'event_request_review') &&
    event.coordinatorId === actor.userId;

  return (
    event.organiserId === actor.userId ||
    mayReview ||
    isActionPermitted(actor.roles, 'coordinator_assignment')
  );
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
