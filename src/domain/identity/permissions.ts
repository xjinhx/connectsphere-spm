import type { Role } from './roles';

/**
 * SCRUM-69 — the list of actions the permission matrix names.
 *
 * PROPOSAL, pending team agreement: clarifications #52/#91 confirm there is
 * no 6th admin role (Operations Manager is the closest fit for any
 * user-admin permissions - #52) and that access follows role/relationship to
 * the event (#91), but both explicitly leave the exact access-control design
 * for the team to propose - there is no external authoritative matrix to
 * copy from. ROLE_PERMISSIONS below covers only the actions already backed
 * by a policy decision elsewhere in the codebase
 * (venues/policy.ts's canManageVenues/canViewVenueCatalogue,
 * identity/policy.ts's canAssignRoles) plus the three actions SCRUM-69 AC2
 * explicitly names as excluded from Event Organiser. Treat this as a first
 * draft for the team to review and extend, not a stand-in for a "real"
 * matrix that exists somewhere else.
 */
export const ACTIONS = [
  'event_request_creation',
  'venue_administration',
  'venue_catalogue_view',
  'equipment_administration',
  'coordinator_assignment',
  'account_role_management',
  // SCRUM-92 — the card's story is "As an Event Coordinator, I want to approve
  // a request". SCRUM-93 (reject) can reuse this action.
  'event_request_approval',
  // SCRUM-89 — "As an Event Coordinator, I want to open a submitted request
  // and see everything the Event Organiser provided". Read-only, kept
  // separate from event_request_approval so viewing and deciding can diverge
  // later without touching each other's grant.
  'event_request_review',
  // SCRUM-90 — "As an Event Coordinator, I want to return a request to the
  // Event Organiser with a note describing what is unclear".
  'event_request_clarification',
  'organisation_membership_management',
] as const;

export type Action = (typeof ACTIONS)[number];

export function isAction(value: unknown): value is Action {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
}

export const ROLE_PERMISSIONS: Record<Role, readonly Action[]> = {
  event_organiser: ['event_request_creation'],
  // SCRUM-204 — the story's persona is the Event Coordinator (matches
  // client-organisation/policy.ts's canManageClientOrganisations, which
  // already gives Coordinators sole ownership of the organisations
  // themselves); organisation_membership_management is the matching
  // permission for linking an Event Organiser account to one.
  coordinator: [
    'venue_catalogue_view',
    'event_request_approval',
    'event_request_review',
    'event_request_clarification',
    'organisation_membership_management',
  ],
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
