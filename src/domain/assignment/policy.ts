import type { EventRequestStatus } from '@/domain/event-request/schema';
import type { Role } from '@/domain/identity/roles';
import { hasRole } from '@/domain/identity/policy';
import { isActionPermitted } from '@/domain/identity/permissions';

/**
 * SCRUM-94 — Assign an Event Coordinator to a submitted event.
 *
 * Pure rules only. The database enforces the same two conditions inside the
 * update itself (see assignCoordinatorToEventRequest), which is what makes AC5
 * safe; these functions are the readable statement of the rules, and let the
 * API answer with a clear error instead of a silent no-op.
 */

/**
 * AC1 — "an event has status Submitted and no assigned coordinator". Both
 * halves matter, and they fail differently: an unsubmitted event is the wrong
 * kind of event, while an assigned one already has an owner (AC5).
 */
export function canBeAssigned(status: EventRequestStatus, coordinatorId: string | null): boolean {
  return status === 'submitted' && coordinatorId === null;
}

/** True once somebody owns the event, whatever its status. */
export function isAssigned(coordinatorId: string | null): boolean {
  return coordinatorId !== null;
}

/**
 * The person being assigned has to be an Event Coordinator - that is the whole
 * noun in "assign an Event Coordinator", and it is what stops an event being
 * owned by an attendee. Note this is about the *target*, not the caller: who
 * may assign is AC4, and is checked in the route through SCRUM-69's permission
 * matrix (`coordinator_assignment`).
 */
export function canReceiveAssignment(roles: readonly Role[]): boolean {
  return hasRole([...roles], 'coordinator');
}

/**
 * AC2 — a coordinator already holding three events takes a fourth. There is no
 * workload limit to apply (clarification #92), so this states the rule rather
 * than counting anything: the number of events a coordinator holds never
 * affects whether they can be given another.
 *
 * Kept as a named constant because "no limit" is a decision the customer made,
 * not an oversight, and AC2's test needs something to point at.
 */
export const COORDINATOR_WORKLOAD_LIMIT: number | null = null;

// ---------------------------------------------------------------------------
// SCRUM-96 — Reassign an event to another coordinator
// SCRUM-98 — See who my coordinator is
// ---------------------------------------------------------------------------

/**
 * SCRUM-96 AC1 — "given an event has an assigned coordinator, when I reassign
 * it to another coordinator". Two conditions, failing differently: an event
 * with no coordinator has nothing to reassign (SCRUM-94 assigns it instead),
 * and "another coordinator" rules out reassigning to the person who already
 * holds it.
 */
export function canBeReassigned(currentCoordinatorId: string | null, newCoordinatorId: string): boolean {
  return currentCoordinatorId !== null && currentCoordinatorId !== newCoordinatorId;
}

/**
 * SCRUM-96 AC4 — a coordinator reassigned away from an event is denied it.
 *
 * Stated positively: a coordinator may see an event's planning information
 * only while they are its current coordinator. Being reassigned away is the
 * moment that stops being true. This is also the "assigned coordinator" rule
 * SCRUM-89 AC1 needs, so any read that shows a coordinator an event's details
 * should check it.
 */
export function isCurrentCoordinator(coordinatorId: string | null, actorUserId: string): boolean {
  return coordinatorId !== null && coordinatorId === actorUserId;
}

/**
 * Who may see an event's coordinator and assignment history.
 *
 * SCRUM-96 AC3 says "when anyone views it", meaning anyone who can view the
 * event: the organiser who owns it (SCRUM-98 AC1), its current coordinator,
 * and the Event Operations Managers who make assignments. A coordinator who
 * has been reassigned away is none of these, so AC4 holds here too.
 */
export function canViewCoordinatorDetails(
  event: { organiserId: string; coordinatorId: string | null },
  actor: { userId: string; roles: readonly Role[] },
): boolean {
  return (
    event.organiserId === actor.userId ||
    isCurrentCoordinator(event.coordinatorId, actor.userId) ||
    isActionPermitted(actor.roles, 'coordinator_assignment')
  );
}
