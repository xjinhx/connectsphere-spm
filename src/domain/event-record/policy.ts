import { isCurrentCoordinator } from '@/domain/assignment/policy';
import { canViewRequest, isOwnRequest } from '@/domain/event-request/policy';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import { hasRole } from '@/domain/identity/policy';
import type { Role } from '@/domain/identity/roles';

/**
 * SCRUM-109 — View the full event record. Pure rules only; service.ts applies them.
 *
 * AC1: a user related to the event sees its details, status, assigned
 * coordinator, venue arrangement, equipment arrangement and registration
 * setting in one place. AC2: a section their role may not see is omitted, not
 * shown empty. AC3: the Event Coordinator Lead sees any active event's status
 * and essential arrangements, read-only.
 *
 * Customer clarification #91 protects internal planning, venue and equipment
 * arrangements and client data "by role and relationship" and leaves the
 * field-level design to the team; #66 does not restrict Venue Staff or
 * Technical Support Staff by venue or equipment. SECTIONS_BY_VIEWER is that
 * design, reusing the rules other stories already set where there is one.
 */

/** How the signed-in user is related to the event. An account can be related in more than one way. */
export const EVENT_RECORD_VIEWERS = [
  'organiser',
  'colleague',
  'coordinator',
  'lead',
  'venue_staff',
  'technical_support',
] as const;
export type EventRecordViewer = (typeof EVENT_RECORD_VIEWERS)[number];

/**
 * The sections AC2 may omit, in page order. Details and status are every
 * viewer's (AC1 and AC3 both show the status), so they are not listed.
 */
export const EVENT_RECORD_SECTIONS = [
  'coordinator',
  'internal',
  'venue',
  'equipment',
  'registration',
  'essential',
] as const;
export type EventRecordSection = (typeof EVENT_RECORD_SECTIONS)[number];

const EVERY_SECTION = EVENT_RECORD_SECTIONS;

export const SECTIONS_BY_VIEWER: Record<EventRecordViewer, readonly EventRecordSection[]> = {
  // The responsible organiser: their event's arrangements, not its internal
  // notes and client contact (SCRUM-110 keeps those to the coordinator and the
  // Lead) or the essential set (internal planning, #91).
  organiser: ['coordinator', 'venue', 'equipment', 'registration'],
  // SCRUM-204 AC3: a colleague in the same client organisation views the
  // request, but canViewCoordinatorDetails does not give them its coordinator.
  colleague: ['venue', 'equipment', 'registration'],
  coordinator: EVERY_SECTION,
  // AC3, and SCRUM-232 AC5: the Lead sees what the coordinator sees, read-only.
  lead: EVERY_SECTION,
  // What a booking is decided on, and who to contact about it.
  venue_staff: ['coordinator', 'venue'],
  // Equipment is delivered to the venue, so where and when as well.
  technical_support: ['coordinator', 'venue', 'equipment'],
};

/**
 * Every way `actor` is related to the event; empty means they may not open
 * its record (AC1: "an event I am permitted to view").
 *
 * organiser, colleague: SCRUM-204's canViewRequest, so a draft stays its
 * owner's alone. coordinator: the current one (a coordinator reassigned away is
 * not, SCRUM-96 AC4). lead: any event past draft (AC3 "any active event", and
 * its history once finished; SCRUM-233's "active" only decides what the
 * overview lists). venue_staff: an event with a booking request, at any venue
 * (#66, SCRUM-147 AC4). technical_support: an event with an equipment request,
 * which is raised by its first line (SCRUM-160 AC10, SCRUM-164 AC5).
 */
export function eventRecordViewers(
  event: {
    organiserId: string;
    clientOrganisationId: string | null;
    coordinatorId: string | null;
    status: EventRequestStatus;
    hasBookingRequest: boolean;
    hasEquipmentRequest: boolean;
  },
  actor: { userId: string; roles: Role[]; clientOrganisationId: string | null },
): EventRecordViewer[] {
  const viewers: EventRecordViewer[] = [];
  if (isOwnRequest(event, actor.userId)) viewers.push('organiser');
  else if (canViewRequest(event, actor)) viewers.push('colleague');
  if (isCurrentCoordinator(event.coordinatorId, actor.userId)) viewers.push('coordinator');
  if (hasRole(actor.roles, 'operations_manager') && event.status !== 'draft') viewers.push('lead');
  if (hasRole(actor.roles, 'venue_staff') && event.hasBookingRequest) viewers.push('venue_staff');
  if (hasRole(actor.roles, 'technical_support') && event.hasEquipmentRequest) viewers.push('technical_support');
  return viewers;
}

/** AC2: the sections any of `viewers` may see, in page order. */
export function sectionsVisibleTo(viewers: readonly EventRecordViewer[]): EventRecordSection[] {
  return EVENT_RECORD_SECTIONS.filter((section) =>
    viewers.some((viewer) => SECTIONS_BY_VIEWER[viewer].includes(section)),
  );
}

/**
 * The coordinator's email and contact number as well as their name: only for
 * those canViewCoordinatorDetails (SCRUM-98) already gives them to. Venue
 * Staff and Technical Support Staff are shown the name.
 */
export function canSeeCoordinatorContact(viewers: readonly EventRecordViewer[]): boolean {
  return viewers.some((viewer) => viewer === 'organiser' || viewer === 'coordinator' || viewer === 'lead');
}

export const NO_ACCESS_MESSAGE = 'You do not have access to this event.';
