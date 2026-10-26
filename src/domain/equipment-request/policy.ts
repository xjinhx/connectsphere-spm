import { isCurrentCoordinator } from '@/domain/assignment/policy';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import { isActionPermitted } from '@/domain/identity/permissions';
import type { Role } from '@/domain/identity/roles';
import type { EquipmentRequestStatus } from './schema';

/**
 * Equipment request rules (SCRUM-160 Record the equipment an event needs).
 * Pure functions: no Supabase, no Next.js.
 */

/**
 * AC1: "Given I am the assigned coordinator of an event that is Approved or in
 * Planning". Any other status does not accept an equipment request edit
 * (TC-160-02) - the same two statuses SCRUM-142 accepts a venue booking request
 * in (canCreateBookingRequest).
 *
 * INTERIM, to confirm at standup (recorded on TC-160-02): Confirmed is refused
 * too, because AC1 names only Approved and Planning.
 */
export function acceptsEquipmentRequest(status: EventRequestStatus): boolean {
  return status === 'approved' || status === 'planning';
}

export const EVENT_NOT_OPEN_FOR_EQUIPMENT_MESSAGE =
  'Equipment can only be requested for an event that is Approved or in Planning.';

/**
 * AC3: "Given I add the same equipment type a second time on the same event,
 * when I save, then a separate line is created and the existing line is shown
 * to me so that I can merge them if that was my intent; lines are never merged
 * automatically."
 *
 * The event's other lines that name the same catalogue item as `added`, in the
 * order given. Empty for a type the event has not asked for before (TC-160-09).
 * Only the request it is given is searched, so the same type on another event
 * is never reported (AC3 says "on the same event").
 */
export function linesOfSameType<T extends { id: string; equipmentId: string }>(
  lines: readonly T[],
  added: { id: string; equipmentId: string },
): T[] {
  return lines.filter((line) => line.id !== added.id && line.equipmentId === added.equipmentId);
}

/**
 * Who may open an event's equipment request.
 *
 * AC6: "Given technical requirements have been entered, when Technical Support
 * Staff open the request, then the notes are displayed with the equipment
 * list". Technical Support Staff are the role that holds
 * equipment_administration (SCRUM-240: equipment is their responsibility), so
 * that existing permission is what lets them open it - no new action is added
 * to SCRUM-69's matrix. The event's assigned coordinator, who records it, may
 * open it too. Nobody else: access follows role and
 * relationship to the event (customer clarification #91), so a coordinator the
 * event is not assigned to is refused, as for every edit (AC4).
 */
export function canViewEquipmentRequest(
  actor: { userId: string; roles: readonly Role[] },
  eventCoordinatorId: string | null,
): boolean {
  return (
    isActionPermitted(actor.roles, 'equipment_administration') ||
    isCurrentCoordinator(eventCoordinatorId, actor.userId)
  );
}

/**
 * AC8: "Given an equipment item has already been reserved, when I attempt to
 * reduce its quantity, then I am warned that a reservation exists and must
 * confirm before the change is applied."
 *
 * `newQuantity` is null for a removal. A reduction of one already needs it
 * (TC-160-23); keeping the same quantity, or raising it, does not, since AC8
 * names only a reduction. An item not yet reserved never needs it - AC7 saves
 * that change immediately (TC-160-20).
 *
 * INTERIM, to confirm at standup (recorded on TC-160-22): removing a reserved
 * item is treated as reducing it to nothing, so it needs the same
 * confirmation, rather than dropping a reservation without a word.
 */
export function needsReservationConfirmation(
  line: { quantity: number; reserved: boolean },
  newQuantity: number | null,
): boolean {
  if (!line.reserved) return false;
  return newQuantity === null || newQuantity < line.quantity;
}

export const RESERVATION_WARNING_MESSAGE =
  'This item has already been reserved. Confirm to apply the change to its reservation.';

// ---------------------------------------------------------------------------
// SCRUM-164 — Queue of equipment requests awaiting review
// ---------------------------------------------------------------------------

/**
 * AC1: "equipment requests ... that are not yet resolved". AC3: fulfilled and
 * unable to fulfil no longer appear as outstanding. AC4: partially fulfilled
 * remains listed. Under review is how every request starts (SCRUM-166 AC1), so
 * it is outstanding too.
 */
export const OUTSTANDING_EQUIPMENT_REQUEST_STATUSES = [
  'under_review',
  'partially_fulfilled',
] as const satisfies readonly EquipmentRequestStatus[];

export function isOutstandingEquipmentRequest(status: EquipmentRequestStatus): boolean {
  return (OUTSTANDING_EQUIPMENT_REQUEST_STATUSES as readonly EquipmentRequestStatus[]).includes(status);
}

/**
 * AC4: "shows how many items are still unavailable". Each unavailable line
 * counts once, whatever its quantity (PO, 18 Oct 2026; TC-164-10): Mic x2 and
 * Lectern x1 unavailable is 2 items, not 3.
 */
export function countUnavailableItems(lines: readonly { unavailable: boolean }[]): number {
  return lines.filter((line) => line.unavailable).length;
}

export const EQUIPMENT_QUEUE_SORTS = ['raised', 'event-date'] as const;
export type EquipmentQueueSort = (typeof EQUIPMENT_QUEUE_SORTS)[number];

/** A sort named in the URL, or the default when it is missing or unknown. */
export function toEquipmentQueueSort(value: unknown): EquipmentQueueSort {
  return EQUIPMENT_QUEUE_SORTS.find((sort) => sort === value) ?? 'raised';
}

/**
 * The order the queue is shown in. The same two orders as SCRUM-147's booking
 * queue (sortBookingQueue), so the two queues behave alike.
 *
 * 'raised' (the default; the card sets none): the oldest request first.
 * 'event-date' (AC2): the soonest event first. Dates are compared as
 *   YYYY-MM-DD strings, which order the same way as the calendar, never as
 *   displayed text (TC-164-05: 3 Jan 2027 sorts after 28 Dec 2026). An event
 *   with no date yet goes last: there is nothing to say it is soon.
 *
 * Ties fall back to the other order, then the event id, so the result is
 * stable. Returns a new array; the input is not reordered in place.
 */
export function sortEquipmentQueue<T extends { eventRequestId: string; eventDate: string | null; raisedAt: string }>(
  entries: readonly T[],
  sort: EquipmentQueueSort,
): T[] {
  const byRaised = (a: T, b: T) => Date.parse(a.raisedAt) - Date.parse(b.raisedAt);
  const byDate = (a: T, b: T) => {
    if (a.eventDate === b.eventDate) return 0;
    if (a.eventDate === null) return 1;
    if (b.eventDate === null) return -1;
    return a.eventDate.localeCompare(b.eventDate);
  };
  const byEvent = (a: T, b: T) => a.eventRequestId.localeCompare(b.eventRequestId);
  const order: Record<EquipmentQueueSort, (a: T, b: T) => number> = {
    raised: (a, b) => byRaised(a, b) || byDate(a, b) || byEvent(a, b),
    'event-date': (a, b) => byDate(a, b) || byRaised(a, b) || byEvent(a, b),
  };
  return [...entries].sort(order[sort]);
}

/**
 * Days from `today` to the event's date (both YYYY-MM-DD, Singapore): 0 on
 * the day, negative once it has passed, null when the event has no date. The
 * queue shows it beside the date so the nearest events stand out.
 */
export function daysUntilEvent(eventDate: string | null, today: string): number | null {
  if (eventDate === null) return null;
  const DAY_MS = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(`${eventDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

// ---------------------------------------------------------------------------
// SCRUM-166 — Update the status of an equipment request
// ---------------------------------------------------------------------------

/**
 * AC3: "Given some requested items are available and others are not, when I
 * set the status to partially fulfilled, then I cannot save until every
 * unavailable item is identified." Technical Support Staff decide which items
 * are unavailable, so the rule the app can hold them to is that at least one
 * is marked (TC-166-11: none is refused; TC-166-12: one of two saves).
 */
export const IDENTIFY_UNAVAILABLE_MESSAGE =
  'Mark every item that is unavailable before saving the request as partially fulfilled.';

/** AC4: "when I save, then a reason is mandatory" (TC-166-14, TC-166-15). */
export const REASON_REQUIRED_MESSAGE = 'Give the reason the request cannot be fulfilled.';

/** A line id that is not on this request (sent by hand, or a line removed meanwhile). */
export const UNKNOWN_LINE_MESSAGE = 'One of the items marked unavailable is not on this request.';

export type StatusUpdateProblem = { field: 'unavailableLineIds' | 'reason'; message: string };

/**
 * What stops a status update from being saved, or null when nothing does.
 * Checked before anything is written, so a refusal leaves the request as it
 * was.
 *
 * `requestLineIds` are the ids of the request's lines. Marked lines are only
 * looked at for partially fulfilled, and the reason only for unable to fulfil:
 * for every other status they are not kept (statusUpdateToStore).
 */
export function statusUpdateProblem(
  update: { status: EquipmentRequestStatus; unavailableLineIds: readonly string[]; reason: string | null },
  requestLineIds: readonly string[],
): StatusUpdateProblem | null {
  if (update.status === 'partially_fulfilled') {
    if (update.unavailableLineIds.length === 0) {
      return { field: 'unavailableLineIds', message: IDENTIFY_UNAVAILABLE_MESSAGE };
    }
    if (update.unavailableLineIds.some((id) => !requestLineIds.includes(id))) {
      return { field: 'unavailableLineIds', message: UNKNOWN_LINE_MESSAGE };
    }
  }
  if (update.status === 'unable_to_fulfil' && (update.reason === null || update.reason.trim() === '')) {
    return { field: 'reason', message: REASON_REQUIRED_MESSAGE };
  }
  return null;
}

/**
 * What is stored for an update: marked lines only for partially fulfilled
 * (AC3; SCRUM-164's queue counts them only then), the reason only for unable
 * to fulfil (AC4). Each save replaces the last, so a later status never shows
 * an earlier one's items or reason. set_equipment_request_status applies the
 * same rule in the database.
 */
export function statusUpdateToStore(update: {
  status: EquipmentRequestStatus;
  unavailableLineIds: readonly string[];
  reason: string | null;
}): { status: EquipmentRequestStatus; unavailableLineIds: string[]; reason: string | null } {
  return {
    status: update.status,
    unavailableLineIds: update.status === 'partially_fulfilled' ? [...new Set(update.unavailableLineIds)] : [],
    reason: update.status === 'unable_to_fulfil' ? update.reason : null,
  };
}

/**
 * AC4: "the coordinator is notified" - when the request is set to unable to
 * fulfil. The card names no notification for the other statuses; the
 * coordinator sees those on the request (AC2).
 */
export function notifiesCoordinator(status: EquipmentRequestStatus): boolean {
  return status === 'unable_to_fulfil';
}

/** AC4: the notification the assigned coordinator receives, naming the event and the reason. */
export function unableToFulfilMessage(event: { reference: string; name: string }, reason: string): string {
  return `Technical Support cannot fulfil the equipment request for ${event.reference} (${event.name}): ${reason}`;
}
