import type { EventRequestStatus } from '@/domain/event-request/schema';

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
 * Moves the Sprint 2 lifecycle adds. Apart from AC4's row, these are a
 * proposal for the team, not on the card:
 *   approved -> planning                     SCRUM-101 AC3, first request raised
 *   planning -> confirmed                    arrangements in place
 *   confirmed -> planning                    AC4, a significant change
 *   confirmed -> completed                   the event has happened
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
  confirmed: ['planning', 'completed', 'cancelled'],
  rejected: [],
  completed: [],
  cancelled: [],
};

/** True if an event in `from` may move to `to`. Staying where it is is not a move. */
export function canTransition(from: EventRequestStatus, to: EventRequestStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
