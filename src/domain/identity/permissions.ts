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
  // SCRUM-142 — "As an Event Coordinator, I want to request a specific venue
  // for the slots my event needs". Enforcement at the route layer is
  // deferred (this ticket stops at the domain layer, matching SCRUM-101's
  // precedent); adding the action now so it exists for whoever wires the
  // route to check it, per the contract-first workflow.
  'venue_booking_request',
  // SCRUM-240 AC5 — "when a coordinator records an equipment requirement
  // (SCRUM-160), then they can only choose items that exist in the
  // catalogue": choosing from the catalogue means reading it, which AC3 does
  // not refuse (it refuses adding and changing). Kept separate from
  // equipment_administration so looking and maintaining can diverge, the same
  // split as venue_catalogue_view and venue_administration.
  'equipment_catalogue_view',
  // SCRUM-100 — "As an Event Coordinator, I want to mark which arrangements
  // are essential for this particular event". The narrower rule, the event's
  // assigned coordinator only (AC1), is in the service.
  'essential_arrangements_record',
  // SCRUM-160 — "As an Event Coordinator, I want to record the equipment an
  // event needs with quantities". The narrower rule (this event's assigned
  // coordinator, AC4) needs the event, so it is in the service, the same split
  // as venue_booking_request.
  'equipment_request',
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
    'venue_booking_request',
    // SCRUM-240 AC5: the catalogue is the list an equipment requirement
    // (SCRUM-160) is chosen from, so a Coordinator may read it. Not granted to
    // the other roles, because no story names them reading it yet.
    'equipment_catalogue_view',
    // SCRUM-100 AC1: only the event's assigned coordinator, so no other role.
    'essential_arrangements_record',
    // SCRUM-160: record the equipment their event needs.
    'equipment_request',
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
