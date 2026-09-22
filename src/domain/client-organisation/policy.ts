import { hasRole } from '@/domain/identity/policy';
import type { Role } from '@/domain/identity/roles';

/** SCRUM-203 — only an Event Coordinator creates or maintains an organisation. */
export function canManageClientOrganisations(roles: Role[]): boolean {
  return hasRole(roles, 'coordinator');
}
