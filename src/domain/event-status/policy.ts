import { EVENT_REQUEST_STATUS_LABELS, type EventRequestStatus } from '@/domain/event-request/schema';
import { addDays } from '@/domain/equipment-reservation/policy';
import { formatDayMonthYear, isPastDate, toSingaporeISODate, type ISODate } from '@/domain/shared/dates';

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
 *   preparation -> completed | cancelled     SCRUM-234 card notes (CL-27);
 *                                            additions only: confirmed ->
 *                                            completed stays, and the guard
 *                                            against completing an unchecked
 *                                            event is SCRUM-104's
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
 * SCRUM-234 AC5 — "Given an event has not been approved by the Safety Officer,
 * when anyone attempts to move it to Preparation, then it is refused."
 *
 * Confirmed -> Preparation is in the lifecycle above, but only the Safety
 * Officer's approval makes it: record_safety_check
 * (20261018193100_operational_safety_check.sql) records the approval and moves
 * the event together. Every other way of changing a status asks this first and
 * refuses a move into Preparation, so there is no path to it without an
 * approval on record.
 */
export function needsSafetyApproval(to: EventRequestStatus): boolean {
  return to === 'preparation';
}

/**
 * SCRUM-102 — only an event in Planning can be confirmed: the one status the
 * lifecycle above moves to Confirmed (TC-102-16).
 */
export function canBeConfirmed(status: EventRequestStatus): boolean {
  return canTransition(status, 'confirmed');
}

export function confirmationStatusRefusal(status: EventRequestStatus): string {
  return `Only an event in Planning can be confirmed. This event is ${EVENT_REQUEST_STATUS_LABELS[status]}.`;
}

/**
 * SCRUM-104 — Mark an event as completed.
 *
 * The same rules as complete_event and complete_past_events
 * (20261027060115_event_completion.sql), restated here for the page and the
 * service because the database cannot import them: change one, change the
 * other. The end date is the last day of the event's confirmed venue bookings,
 * or its proposed date when it has none (event_end_date in that file).
 */

/**
 * AC5: only an event in Preparation, the one status reached through an approved
 * safety check (SCRUM-234), so any other status has not passed it (CL-60).
 * Narrower than ALLOWED_TRANSITIONS, which still lists confirmed -> completed.
 */
export function canBeCompleted(status: EventRequestStatus): boolean {
  return status === 'preparation';
}

/** AC1, AC4: the end date has passed when it is before today (Singapore). */
export function hasEnded(endDate: ISODate | null, today: ISODate): boolean {
  return endDate !== null && isPastDate(endDate, today);
}

/** AC2, AC3: how long after its end date the completion check completes an event. */
export const COMPLETION_CHECK_DAYS = 7;

/** AC2, AC3: a Preparation event 7 or more days past its end date; never one 6 days past. */
export function isDueForCompletionCheck(status: EventRequestStatus, endDate: ISODate | null, today: ISODate): boolean {
  return canBeCompleted(status) && endDate !== null && endDate <= addDays(today, -COMPLETION_CHECK_DAYS);
}

export function completionStatusRefusal(status: EventRequestStatus): string {
  return `Only an event in Preparation can be marked completed: it must pass the Operational Safety Check first. This event is ${EVENT_REQUEST_STATUS_LABELS[status]}.`;
}

export const NOT_ENDED_YET = "This event can't be marked completed until its end date has passed.";

// -----------------------------------------------------------------------------
// SCRUM-105 — Cancel an event at any stage
// -----------------------------------------------------------------------------

/**
 * AC1 "an event in any status": Submitted to Preparation, the statuses
 * EVENT_STATUS_TRANSITIONS lets move to Cancelled. A Draft has no coordinator
 * yet, and Rejected, Completed and Cancelled are final. cancel_event
 * (20261030070000_cancel_event.sql) checks the same list with the event
 * locked: change one, change the other.
 */
export function canBeCancelled(status: EventRequestStatus): boolean {
  return status !== 'draft' && canTransition(status, 'cancelled');
}

/** AC1: why an event in a final status (or a Draft) cannot be cancelled. */
export function cancellationStatusRefusal(status: EventRequestStatus): string {
  return `This event is ${EVENT_REQUEST_STATUS_LABELS[status]} and cannot be cancelled.`;
}

/** AC1: when it was cancelled, as DD/MM/YYYY HH:mm in Singapore. */
export function formatCancelledAt(instant: string): string {
  const date = new Date(instant);
  const time = new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  return `${formatDayMonthYear(toSingaporeISODate(date))} ${time}`;
}

/** What cancel_event released, as the notifications need it. */
export interface CancelledArrangements {
  organiserId: string;
  /** AC3, AC6: each released booking and the Venue Staff who approved it (null if unknown). */
  bookings: { venueName: string; date: string; startTime: string; endTime: string; approvedBy: string | null }[];
  /** AC3: each released reservation and who reserved it (null if unknown). */
  reservations: { equipmentName: string; quantity: number; reservedBy: string | null }[];
  /** AC4: every attendee with an active registration. */
  attendeeIds: string[];
}

/**
 * AC4, AC6 — who is told, and what. One notification per person (TC-105-13):
 *   - the organiser, with the reason;
 *   - each Venue Staff member who approved a released booking, naming the
 *     venues, dates and times that are free again (AC6);
 *   - each Technical Support Staff member who reserved released equipment,
 *     naming what was released;
 *   - each attendee with an active registration.
 * Someone in more than one group (e.g. Venue Staff who also reserved
 * equipment) gets one notification with every part that applies.
 */
export function cancellationNotices(
  event: { name: string; reference: string; reason: string },
  released: CancelledArrangements,
): { recipientId: string; message: string }[] {
  const headline = `${event.name} (${event.reference}) has been cancelled and will not take place.`;
  const parts = new Map<string, string[]>();
  const add = (recipientId: string | null, part: string) => {
    if (!recipientId) return;
    const list = parts.get(recipientId) ?? [];
    if (!list.includes(part)) list.push(part);
    parts.set(recipientId, list);
  };

  add(released.organiserId, `Reason: ${event.reason}`);

  const freedByApprover = new Map<string, string[]>();
  for (const booking of released.bookings) {
    if (!booking.approvedBy) continue;
    const times = `${booking.venueName}, ${formatDayMonthYear(booking.date)}, ${booking.startTime.slice(0, 5)} to ${booking.endTime.slice(0, 5)}`;
    freedByApprover.set(booking.approvedBy, [...(freedByApprover.get(booking.approvedBy) ?? []), times]);
  }
  for (const [approver, times] of freedByApprover) {
    add(approver, `These venue times are free again: ${times.join('; ')}.`);
  }

  const releasedByReserver = new Map<string, string[]>();
  for (const reservation of released.reservations) {
    if (!reservation.reservedBy) continue;
    const item = `${reservation.equipmentName} × ${reservation.quantity}`;
    releasedByReserver.set(reservation.reservedBy, [...(releasedByReserver.get(reservation.reservedBy) ?? []), item]);
  }
  for (const [reserver, items] of releasedByReserver) {
    add(reserver, `Its equipment reservations are released: ${items.join(', ')}.`);
  }

  for (const attendeeId of released.attendeeIds) {
    if (!parts.has(attendeeId)) parts.set(attendeeId, []);
  }

  return [...parts].map(([recipientId, extra]) => ({
    recipientId,
    message: [headline, ...extra].join(' '),
  }));
}
