import type { EventRequestStatus } from '@/domain/event-request/schema';

/**
 * SCRUM-187 AC1/AC2/AC5 — which statuses offer the change-request action.
 *
 * Status scope deliberately narrow for now: only the two statuses AC1 names
 * literally (submitted, confirmed). AC5 excludes only cancelled and
 * completed, which would also allow approved, clarification_requested,
 * planning and preparation - but that reading is not yet confirmed (Slack,
 * 24 Oct 2026), so this starts with the safe subset that is correct either
 * way the PO answers, structured as a list so widening it later is a
 * one-line change.
 */
const STATUSES_ALLOWING_CHANGE_REQUEST: readonly EventRequestStatus[] = ['submitted', 'confirmed'];

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
