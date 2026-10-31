import type { EventRequestStatus } from '@/domain/event-request/schema';
import { formatDayMonthYear, isISODate } from '@/domain/shared/dates';
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
export function formatChangeRequestValue(
  field: SelectableChangeRequestField,
  value: unknown,
  names: ChangeRequestValueNames = {},
): string {
  if (value === null || value === undefined) return '—';
  if (field === 'proposedDate' && typeof value === 'string' && isISODate(value)) {
    return formatDayMonthYear(value);
  }
  // SCRUM-274: the two list fields read by name, not as ids or [object Object].
  if (field === 'accessibilityFeatureIds' && Array.isArray(value)) {
    if (value.length === 0) return 'None';
    return value.map((id) => names.accessibilityFeatures?.get(String(id)) ?? 'Unknown feature').join(', ');
  }
  if (field === 'equipmentItems' && Array.isArray(value)) {
    if (value.length === 0) return 'None';
    return value.map(describeEquipmentLine).join(', ');
  }
  return String(value);
}

/** SCRUM-274: names for values stored as ids, e.g. accessibility feature id → "Step-free access". */
export interface ChangeRequestValueNames {
  accessibilityFeatures?: ReadonlyMap<string, string>;
}

/** An equipment line, stored or proposed, as "Projector P-100 × 2". */
function describeEquipmentLine(line: unknown): string {
  if (typeof line !== 'object' || line === null) return String(line);
  const { item, quantity } = line as { item?: unknown; quantity?: unknown };
  return `${String(item ?? '—')} × ${String(quantity ?? '—')}`;
}
