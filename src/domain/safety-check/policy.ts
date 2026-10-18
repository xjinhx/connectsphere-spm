import { isCurrentCoordinator } from '@/domain/assignment/policy';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import { isActionPermitted } from '@/domain/identity/permissions';
import type { Role } from '@/domain/identity/roles';
import type { SafetyCheckDecision } from './schema';

/**
 * Operational safety check rules (SCRUM-234). Pure functions: no Supabase, no
 * Next.js.
 */

/**
 * AC1, AC3: "Given an event is Confirmed". Only a Confirmed event is awaiting
 * a check and only one can be decided (TC-234-02, TC-234-09). The database
 * function checks the same thing again under a lock, so a decision raced by
 * another one is refused there too.
 */
export function isAwaitingSafetyCheck(status: EventRequestStatus): boolean {
  return status === 'confirmed';
}

export const NOT_AWAITING_CHECK_MESSAGE = 'Only a Confirmed event can be given a safety check decision.';

/**
 * AC3, AC4: where each decision sends the event. Rejecting returns it to
 * Planning, not Cancelled (customer clarification #130: it is revised and
 * resubmitted). record_safety_check restates this in SQL; change one, change
 * the other.
 */
export const STATUS_AFTER_DECISION: Readonly<Record<SafetyCheckDecision, EventRequestStatus>> = {
  approved: 'preparation',
  changes_requested: 'planning',
  rejected: 'planning',
};

/** AC6: the list, the check page and every decision are the Safety Officer's. */
export function canRunSafetyCheck(roles: readonly Role[]): boolean {
  return isActionPermitted(roles, 'safety_check');
}

/**
 * AC4: "its assigned coordinator sees the reason", for a rejection and a
 * request for changes alike. The event's current coordinator, and the Safety
 * Officer who runs the checks; nobody else is named by the card (other staff
 * seeing it is a separate story, per the PO, 18 Oct).
 */
export function canViewSafetyOutcome(
  actor: { userId: string; roles: readonly Role[] },
  event: { coordinator_id: string | null },
): boolean {
  return canRunSafetyCheck(actor.roles) || isCurrentCoordinator(event.coordinator_id, actor.userId);
}
