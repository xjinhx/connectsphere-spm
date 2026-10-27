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
  // SCRUM-234 AC6 — "As a Safety Officer, I want to review each confirmed
  // event's safety arrangements"; a seventh role (Change Log CL-27). Covers opening the list and the check page as
  // well as deciding, because AC2's details are only shown to decide with.
  'safety_check',
  // SCRUM-110 — "As an Event Coordinator, I want to update descriptive event
  // information without triggering a review of arrangements". The narrower
  // rule (this event's assigned coordinator, AC1) needs the event, so it is in
  // the service, the same split as essential_arrangements_record.
  'event_information_edit',
  // SCRUM-111 — change the date, times, attendance or venue requirements and
  // re-confirm the arrangements that change flags. Only the event's assigned
  // coordinator, checked in the service like event_information_edit.
  'event_schedule_change',
  // SCRUM-181 — "As an Attendee, I want to register for an event and provide
  // the information required". Attendees sign in with the Attendee role, and
  // AC5 matches a registration to that signed-in account (PO, 23/10/2026).
  'event_registration',
  // SCRUM-102 — "As an Event Coordinator, I want the system to stop me
  // confirming an event while something essential is still outstanding". The
  // narrower rule, the event's assigned coordinator only, is in the service.
  'event_confirmation',
  // SCRUM-104 — "Mark an event as completed". The event's assigned coordinator
  // only, checked in the service.
  'event_completion',
  // SCRUM-185 AC5 — set an event's registration start date, end date and
  // capacity. Only the event's assigned coordinator, checked in the service.
  'registration_settings_edit',
  // SCRUM-185 AC2 — export an event's registration list. Only the Event
  // Organiser responsible for the event (AC3: not a colleague), checked in the
  // service.
  'registration_list_export',
] as const;

export type Action = (typeof ACTIONS)[number];

export function isAction(value: unknown): value is Action {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
}

export const ROLE_PERMISSIONS: Record<Role, readonly Action[]> = {
  // SCRUM-185 AC2: export the registration list of their own event.
  event_organiser: ['event_request_creation', 'registration_list_export'],
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
    // SCRUM-110 AC1: only the event's assigned coordinator, so no other role.
    'event_information_edit',
    // SCRUM-111 AC1, AC9: only the event's assigned coordinator.
    'event_schedule_change',
    // SCRUM-102: confirm their event once its essential arrangements are complete.
    'event_confirmation',
    // SCRUM-104: mark their event completed once it has happened.
    'event_completion',
    // SCRUM-185 AC5: only the event's assigned coordinator.
    'registration_settings_edit',
  ],
  operations_manager: ['venue_catalogue_view', 'coordinator_assignment', 'account_role_management'],
  venue_staff: ['venue_administration', 'venue_catalogue_view'],
  technical_support: ['venue_catalogue_view', 'equipment_administration'],
  // SCRUM-181: register for an event.
  attendee: ['event_registration'],
  safety_officer: ['safety_check'],
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
