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
 * AC3-AC5: where each decision sends the event. Rejecting returns it to
 * Planning, not Cancelled (customer clarification #130: it is revised and
 * resubmitted). record_safety_check restates this in SQL; change one, change
 * the other.
 */
export const STATUS_AFTER_DECISION: Readonly<Record<SafetyCheckDecision, EventRequestStatus>> = {
  approved: 'preparation',
  changes_requested: 'planning',
  rejected: 'planning',
};

/** AC7: the list, the check page and every decision are the Safety Officer's. */
export function canRunSafetyCheck(roles: readonly Role[]): boolean {
  return isActionPermitted(roles, 'safety_check');
}

/**
 * AC4: "the assigned coordinator sees the note" (and, by the same reading,
 * AC5's reason). The event's current coordinator, and the Safety Officer who
 * runs the checks; nobody else is named by the card.
 */
export function canViewSafetyOutcome(
  actor: { userId: string; roles: readonly Role[] },
  event: { coordinator_id: string | null },
): boolean {
  return canRunSafetyCheck(actor.roles) || isCurrentCoordinator(event.coordinator_id, actor.userId);
}
