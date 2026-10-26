import { isCurrentCoordinator } from '@/domain/assignment/policy';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import { formatDayMonthYear, isISODate } from '@/domain/shared/dates';
import { changeCauses, changedKinds } from '@/domain/significant-change/policy';
import type { ScheduleValues } from '@/domain/significant-change/schema';
import type { SelectableChangeRequestField } from './schema';

/**
 * SCRUM-187 AC1/AC2/AC5 — which statuses offer the change-request action.
 *
 * PO clarification, 24 Oct 2026 (CL-61): offered from Submitted until the
 * event is finished - Submitted, Approved, Planning, Confirmed, Preparation.
 * Not Draft or Clarification Requested (AC2 - the organiser edits the
 * request directly, SCRUM-90), nor Rejected, Cancelled or Completed (final,
 * AC5).
 */
const STATUSES_ALLOWING_CHANGE_REQUEST: readonly EventRequestStatus[] = [
  'submitted',
  'approved',
  'planning',
  'confirmed',
  'preparation',
];

export function canRaiseChangeRequest(status: EventRequestStatus): boolean {
  return STATUSES_ALLOWING_CHANGE_REQUEST.includes(status);
}

/**
 * AC4 — only the organiser responsible for the event may raise a change
 * request; a colleague in the same client organisation who can view it
 * (canViewRequest, domain/event-request/policy.ts) gets no action. This is
 * deliberately the ownership check (isOwnRequest), not the view check.
 */
export function canRaiseChangeRequestFor(
  request: { organiserId: string },
  actorUserId: string,
): boolean {
  return request.organiserId === actorUserId;
}

/**
 * SCRUM-272 (bug on AC6): how one side of a change request line is shown.
 * A date is shown as DD/MM/YYYY, the format agreed at Sprint 4 Planning, not
 * as the stored YYYY-MM-DD; a missing value is shown as "—". Every other
 * value is shown as before.
 */
export function formatChangeRequestValue(field: SelectableChangeRequestField, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (field === 'proposedDate' && typeof value === 'string' && isISODate(value)) {
    return formatDayMonthYear(value);
  }
  return String(value);
}

/**
 * SCRUM-190/191 — only the event's assigned coordinator decides a change
 * request (same rule as SCRUM-110/111's "who may change it":
 * isCurrentCoordinator). Not the Event Coordinator Lead and not the
 * organiser who raised it.
 */
export function canDecideChangeRequestFor(event: { coordinatorId: string | null }, actorUserId: string): boolean {
  return isCurrentCoordinator(event.coordinatorId, actorUserId);
}

/**
 * SCRUM-190 AC2 — venue/equipment requirements, read the way a change
 * request names them rather than the event-schedule form's `requirements`
 * (SCRUM-111 only ever edits roomLayout/accessibility together, with no
 * separate venue/equipment split). A change request can touch either
 * independently of the other, so each is its own kind here.
 */
export interface ChangeRequestExtras {
  preferredLocationId: string | null;
  accessibilityFeatureIds: readonly string[];
  equipmentRequired: boolean | null;
  equipmentItems: readonly { item: string; quantity: number }[];
  technicalSupportNotes: string | null;
}

function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sorted = (ids: readonly string[]) => [...ids].sort();
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}

function sameEquipmentItems(
  a: readonly { item: string; quantity: number }[],
  b: readonly { item: string; quantity: number }[],
): boolean {
  const normalise = (items: readonly { item: string; quantity: number }[]) =>
    [...items].map((entry) => ({ item: entry.item.trim().toLowerCase(), quantity: entry.quantity })).sort((x, y) => x.item.localeCompare(y.item));
  return JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));
}

/**
 * AC2 — whether approving this change request would be a "significant"
 * change: date, times, expected attendance, venue requirements (the
 * preferred location or the accessibility answer/features) or equipment
 * requirements (whether equipment is required, the item list, or the
 * technical support notes). A purely descriptive change (name, purpose,
 * description, registrationRequired) never trips this, same reasoning as
 * SCRUM-111 AC3.
 */
export function changeRequestIsSignificant(
  before: ScheduleValues & ChangeRequestExtras,
  after: ScheduleValues & ChangeRequestExtras,
): boolean {
  if (changedKinds(before, after).length > 0) return true;
  if (before.preferredLocationId !== after.preferredLocationId) return true;
  if (!sameIdSet(before.accessibilityFeatureIds, after.accessibilityFeatureIds)) return true;
  if (before.equipmentRequired !== after.equipmentRequired) return true;
  if (!sameEquipmentItems(before.equipmentItems, after.equipmentItems)) return true;
  if ((before.technicalSupportNotes ?? '') !== (after.technicalSupportNotes ?? '')) return true;
  return false;
}

/**
 * AC4 — which existing venue bookings/equipment reservations the approved
 * change affects, and the cause recorded on each. Reuses SCRUM-111's own
 * taxonomy exactly (a booking by date/times/attendance/requirements, a
 * reservation by date/times only): equipment list or technical-support
 * changes do not themselves flag an existing reservation, the same way they
 * do not on SCRUM-111's own event-schedule edit.
 */
export function changeRequestArrangementCauses(before: ScheduleValues, after: ScheduleValues) {
  return changeCauses(before, after);
}
