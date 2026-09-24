import { Role } from './roles';
import { ForbiddenError } from '@/domain/shared/errors';
import type { Action } from './permissions';
import { isActionPermitted } from './permissions';

export function hasRole(userRoles: Role[], required: Role): boolean {
  return userRoles.includes(required);
}

export function hasAnyRole(userRoles: Role[], required: Role[]): boolean {
  return required.some((role) => userRoles.includes(role));
}

/**
 * SCRUM-69 AC3 — refuse an action absent from the caller's permitted list.
 * Callers should invoke this before doing any work or reading any data for
 * a permission-gated action, so a refusal never leaks a partial result.
 */
export function assertPermission(userRoles: Role[], action: Action): void {
  if (!isActionPermitted(userRoles, action)) {
    throw new ForbiddenError(`Your role does not permit this action: ${action}.`);
  }
}

export function canAssignRoles(actorRoles: Role[], targetAccountId: string, actorAccountId: string): boolean {
  const isSelf = targetAccountId === actorAccountId;
  const isAdmin = hasRole(actorRoles, 'operations_manager');
  return isAdmin && !isSelf;
}

/**
 * SCRUM-72 AC2 / customer clarification #91 — an account acting purely as an
 * Attendee may not read internal planning data by requesting it directly.
 *
 * A few reads elsewhere in the codebase (getApprovalView, getClarificationView
 * in domain/review/service.ts) were built with no role check at all, because
 * their own Jira cards (SCRUM-92 AC3, SCRUM-90) say "anyone" may view them -
 * written before clarification #91 existed. This is only the coarse first
 * gate: it turns away an Attendee-only account. It does NOT mean every other
 * role keeps access. Later fixes (SCRUM-89/90/220) narrow reads such as the
 * clarification view further, to people connected to the request itself -
 * its owning organiser, its assigned coordinator, and the operations manager -
 * so check the read's own service function for the rule that applies.
 */
const ROLES_WITH_LEGITIMATE_PLANNING_ACCESS: Role[] = [
  'event_organiser',
  'coordinator',
  'operations_manager',
  'venue_staff',
  'technical_support',
];

export function isAttendeeOnly(userRoles: Role[]): boolean {
  return hasRole(userRoles, 'attendee') && !hasAnyRole(userRoles, ROLES_WITH_LEGITIMATE_PLANNING_ACCESS);
}

/**
 * SCRUM-204 AC1 — client organisation membership only means something for an
 * Event Organiser account. The actor's permission to act at all is checked
 * separately via assertPermission(actorRoles, 'organisation_membership_management');
 * this is the second half - whether the target account is eligible.
 */
export function canAssignOrganisation(targetRoles: Role[]): boolean {
  return hasRole(targetRoles, 'event_organiser');
}