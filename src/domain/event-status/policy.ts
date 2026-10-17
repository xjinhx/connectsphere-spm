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
 * raised against the event (customer clarification #80; see also SCRUM-142,
 * which raises it). Idempotent: an event
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
 * booking request being raised. enterPlanning() (service.ts) is the write
 * this guards. In the app the move is made by the trigger on
 * venue_booking_request (20261006100000_event_request_enter_planning_on_
 * booking_request.sql), which restates this rule in SQL because the database
 * cannot import it; change one, change the other.
 */
export function canEnterPlanning(status: EventRequestStatus): boolean {
  return status === 'approved' || status === 'planning';
}

/**
 * SCRUM-103 — Prevent invalid status transitions.
 *
 * Every move an event may make between statuses, and nothing else. A move not
 * listed here is refused. Pure rules only: changeEventStatus
 * (domain/event-status/service.ts) applies them, and its UPDATE is guarded on
 * the status it read, so the rule cannot be raced past.
 *
 * What *causes* each move (submitting, approving, raising a booking request) is
 * SCRUM-101's, not this story's. This table only says whether a move is
 * allowed at all.
 *
 * Moves the Sprint 1 actions already make, listed so the table describes the
 * whole lifecycle. Those actions write their own status, with their own checks,
 * and do not call canTransition:
 *   draft -> submitted                       SCRUM-82 submit
 *   submitted -> approved | rejected         SCRUM-92 / SCRUM-93
 *   submitted -> clarification_requested     SCRUM-90
 *   clarification_requested -> submitted     SCRUM-91 resubmit
 *
 * Moves the Sprint 2 lifecycle adds. Apart from SCRUM-101 AC3's row and this
 * story's AC4 row, these are a proposal for the team, not on any card:
 *   approved -> planning                     SCRUM-101 AC3, first request raised
 *   planning -> confirmed                    arrangements in place
 *   confirmed -> planning                    AC4, a significant change
 *   confirmed -> completed                   the event has happened
 *   confirmed -> preparation                 SCRUM-234 AC3, safety check approved
 *   preparation -> completed | cancelled     SCRUM-234 card notes
 *   submitted onward -> cancelled            an event can be called off at any
 *                                            point before it is finished
 *
 * The ACs this table answers:
 *   AC1  draft -> confirmed is not listed, so it is refused.
 *   AC2  rejected lists nothing, so rejected -> approved is refused.
 *   AC3  cancelled lists nothing, so it cannot move to any status.
 *   AC4  confirmed -> planning is listed.
 *
 * Also a proposal: a draft is not cancellable. It has
 * not been sent to anyone, and event_request_submitted_at_matches_status only
 * lets a draft have no submitted_at, so a cancelled draft would need that
 * constraint changed. Rejected and completed are final, like cancelled.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<EventRequestStatus, readonly EventRequestStatus[]>> = {
  draft: ['submitted'],
  submitted: ['approved', 'rejected', 'clarification_requested', 'cancelled'],
  clarification_requested: ['submitted', 'cancelled'],
  approved: ['planning', 'cancelled'],
  planning: ['confirmed', 'cancelled'],
  confirmed: ['planning', 'preparation', 'completed', 'cancelled'],
  preparation: ['completed', 'cancelled'],
  rejected: [],
  completed: [],
  cancelled: [],
};

/** True if an event in `from` may move to `to`. Staying where it is is not a move. */
export function canTransition(from: EventRequestStatus, to: EventRequestStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * SCRUM-234 AC6 — "Given an event has not been approved by the Safety Officer,
 * when anyone attempts to move it to Preparation, then it is refused."
 *
 * Confirmed -> Preparation is in the lifecycle above, but only the Safety
 * Officer's approval makes it: record_safety_check
 * (20261017203100_operational_safety_check.sql) records the approval and moves
 * the event together. Every other way of changing a status asks this first and
 * refuses a move into Preparation, so there is no path to it without an
 * approval on record.
 */
export function needsSafetyApproval(to: EventRequestStatus): boolean {
  return to === 'preparation';
}
