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