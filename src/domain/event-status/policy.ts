import type { EventRequestStatus } from '@/domain/event-request/schema';

/**
 * SCRUM-101 — Move an event through its statuses as work is done.
 *
 * Jira AC1/AC2 (Draft -> Submitted, Submitted -> Approved) are not
 * re-implemented here: they already exist from SCRUM-82
 * (canBeSubmitted, src/domain/event-request/policy.ts) and SCRUM-92
 * (canBeApproved, src/domain/review/policy.ts), tested by
 * tests/unit/event-request-submit.test.ts ("lets a draft be submitted, and
 * never a request that already is") and tests/unit/review-policy.test.ts
 * (`canBeApproved`). This file covers only AC3/AC4, the actual new ground:
 * Approved -> Planning.
 *
 * SCRUM-99 ("See the current status of an event") and SCRUM-103 ("Prevent
 * invalid status transitions") are this ticket's siblings under the same
 * Event Status Management epic; extend this file rather than duplicate it if
 * you're building either.
 */

/**
 * AC3/AC4 — Approved -> Planning, when the first venue booking request is
 * raised against the event (customer clarification #80; see also
 * SCRUM-142/143, neither built yet this sprint). Idempotent: an event
 * already in Planning stays there when a further venue booking request is
 * raised (AC4), rather than refusing the second one.
 *
 * Narrowed from "venue booking request or equipment request" to venue
 * booking request only (team decision, agreed after this ticket's Jira card
 * was first read — see the PR description). This function's own logic is
 * unaffected either way: it only inspects the event's current status, never
 * what kind of request triggered the check, so which request types are
 * allowed to call it is entirely the caller's decision, not this function's.
 *
 * This is the transition rule only — it does not itself listen for a venue
 * booking request being raised. SCRUM-142/143's request-creation code should
 * call this (and the service-layer write it guards, once that exists) the
 * moment a request is created.
 */
export function canEnterPlanning(status: EventRequestStatus): boolean {
  return status === 'approved' || status === 'planning';
}
