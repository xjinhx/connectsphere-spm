import type { EventRequestStatus } from '@/domain/event-request/schema';
import type { Role } from '@/domain/identity/roles';
import { hasRole } from '@/domain/identity/policy';

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
