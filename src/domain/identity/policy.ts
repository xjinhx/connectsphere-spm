import { Role } from './roles';

export function hasRole(userRoles: Role[], required: Role): boolean {
  return userRoles.includes(required);
}

export function hasAnyRole(userRoles: Role[], required: Role[]): boolean {
  return required.some((role) => userRoles.includes(role));
}

export function canAssignRoles(actorRoles: Role[], targetAccountId: string, actorAccountId: string): boolean {
  const isSelf = targetAccountId === actorAccountId;
  const isAdmin = hasRole(actorRoles, 'operations_manager');
  return isAdmin && !isSelf;
}