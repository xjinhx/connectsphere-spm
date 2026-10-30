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
export function formatChangeRequestValue(field: SelectableChangeRequestField, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (field === 'proposedDate' && typeof value === 'string' && isISODate(value)) {
    return formatDayMonthYear(value);
  }
  return String(value);
}
