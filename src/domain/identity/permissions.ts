import type { Role } from './roles';

/**
 * SCRUM-69 — the authoritative list of actions the permission matrix names.
 *
 * PROVISIONAL: the real matrix content lives in customer clarifications
 * #52/#91, which weren't available when this was written. This list covers
 * only the actions already backed by a policy decision elsewhere in the
 * codebase (venues/policy.ts's canManageVenues/canViewVenueCatalogue,
 * identity/policy.ts's canAssignRoles) plus the three actions SCRUM-69 AC2
 * explicitly names as excluded from Event Organiser. Replace ROLE_PERMISSIONS
 * below with the confirmed matrix once #52/#91 are resolved - do not treat
 * this as final.
 */
export const ACTIONS = [
  'event_request_creation',
  'venue_administration',
  'venue_catalogue_view',
  'equipment_administration',
  'coordinator_assignment',
  'account_role_management',
] as const;

export type Action = (typeof ACTIONS)[number];

export function isAction(value: unknown): value is Action {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
}

export const ROLE_PERMISSIONS: Record<Role, readonly Action[]> = {
  event_organiser: ['event_request_creation'],
  coordinator: ['venue_catalogue_view'],
  operations_manager: ['venue_catalogue_view', 'coordinator_assignment', 'account_role_management'],
  venue_staff: ['venue_administration', 'venue_catalogue_view'],
  technical_support: ['venue_catalogue_view', 'equipment_administration'],
  attendee: [],
};

/** An account can hold multiple roles; its permitted actions are the union across all of them. */
export function getPermittedActions(roles: readonly Role[]): Action[] {
  const actions = new Set<Action>();
  for (const role of roles) {
    for (const action of ROLE_PERMISSIONS[role]) actions.add(action);
  }
  return [...actions];
}

export function isActionPermitted(roles: readonly Role[], action: Action): boolean {
  return getPermittedActions(roles).includes(action);
}
