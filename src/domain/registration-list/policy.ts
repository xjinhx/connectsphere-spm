import { isCurrentCoordinator } from '@/domain/assignment/policy';
import { canViewRequest, isOwnRequest } from '@/domain/event-request/policy';
import { EVENT_REQUEST_STATUS_LABELS, type EventRequestStatus } from '@/domain/event-request/schema';
import { REGISTRATION_STATUS_LABELS } from '@/domain/event-registration/schema';
import type { Role } from '@/domain/identity/roles';
import { formatDayMonthYear, toSingaporeISODate } from '@/domain/shared/dates';
import type { RegistrationListEntry, RegistrationListViewer } from './schema';

/**
 * SCRUM-185 — View the registration list for an event. Pure rules only;
 * service.ts applies them.
 */

/**
 * AC5: the registration period and capacity are set on a Confirmed event, and
 * are read-only from Preparation on: the safety check approved the event with
 * those numbers (PO, Slack 28 Oct 2026). Restated by updateRegistrationSettingsRow's status filter
 * (src/lib/supabase/registrationList.ts); change one, change the other.
 */
export function acceptsRegistrationSettings(status: EventRequestStatus): boolean {
  return status === 'confirmed';
}

/** AC5: the event's assigned coordinator, while the event is Confirmed. */
export function canEditRegistrationSettings(
  event: { status: EventRequestStatus; coordinatorId: string | null },
  actorUserId: string,
): boolean {
  return isCurrentCoordinator(event.coordinatorId, actorUserId) && acceptsRegistrationSettings(event.status);
}

/**
 * Why the settings can't be saved. An event past Confirmed (or Cancelled) was
 * Confirmed once, so "set once Confirmed" would mislead: from Preparation on
 * they are read-only (CL-65).
 */
export function notConfirmedNotice(status: EventRequestStatus): string {
  const label = EVENT_REQUEST_STATUS_LABELS[status];
  if (status === 'preparation' || status === 'completed' || status === 'cancelled') {
    return `This event is ${label}. Its registration dates and capacity are read-only from Preparation on.`;
  }
  return `This event is ${label}. Registration is set once the event is Confirmed.`;
}

/**
 * AC6: the most the capacity may be. For an event with several venues, the
 * largest of their capacities, not the smallest (Sprint 4 Planning, CL-59):
 * SCRUM-230 gives each booking its own attendance. Null when the event has no
 * confirmed venue.
 */
export function largestVenueCapacity(capacities: readonly number[]): number | null {
  return capacities.length === 0 ? null : Math.max(...capacities);
}

/** AC6: the message naming the capacity field and the limit it went over. */
export function capacityOverVenueMessage(limit: number): string {
  return `Capacity must be no more than ${limit}, the largest capacity of this event's venues.`;
}

/**
 * AC6 caps the capacity at what the venues hold, and with no confirmed booking
 * that is nothing, so the save is refused on the capacity field. Matches
 * CL-63: no capacity, no registration. Wording and reading from the PO (Slack,
 * 28 Oct 2026).
 */
export const NO_CONFIRMED_VENUE_MESSAGE = "This event has no confirmed venue booking, so a capacity can't be set yet.";

export const NOT_ASSIGNED_MESSAGE = 'This event is not assigned to you.';

// ---------------------------------------------------------------------------
// AC1-AC4 — the registration list
// ---------------------------------------------------------------------------

/**
 * Registration opens once the event is Confirmed (AC5), so the list has
 * something to show from then on, and stays readable afterwards. The event
 * pages offer their link in these statuses; the list page opens in any.
 */
export function hasRegistrationList(status: EventRequestStatus): boolean {
  return status === 'confirmed' || status === 'preparation' || status === 'completed';
}

/**
 * Who may open the list, and as what:
 *   AC1 the event's assigned coordinator ('coordinator');
 *   the Event Coordinator Lead, read-only, as on the coordinator's event page
 *       (SCRUM-232 AC5) ('lead');
 *   AC2 the Event Organiser responsible for the event ('organiser');
 *   AC3 an Event Organiser in the same client organisation ('colleague');
 *   AC4 anyone else: null, access denied. That includes a coordinator the
 *       event is not assigned to.
 * The organiser rules are SCRUM-204's (isOwnRequest, canViewRequest), the same
 * as the request page's.
 */
export function registrationListViewer(
  event: {
    status: EventRequestStatus;
    coordinatorId: string | null;
    organiserId: string;
    clientOrganisationId: string | null;
  },
  actor: { userId: string; roles: readonly Role[]; clientOrganisationId: string | null },
): RegistrationListViewer | null {
  if (actor.roles.includes('coordinator') && isCurrentCoordinator(event.coordinatorId, actor.userId)) {
    return 'coordinator';
  }
  if (actor.roles.includes('operations_manager')) return 'lead';
  if (!actor.roles.includes('event_organiser')) return null;
  if (isOwnRequest(event, actor.userId)) return 'organiser';
  if (canViewRequest(event, { userId: actor.userId, clientOrganisationId: actor.clientOrganisationId })) {
    return 'colleague';
  }
  return null;
}

/** AC2, AC3: only the organiser responsible for the event exports it. */
export function canExportRegistrationList(viewer: RegistrationListViewer | null): boolean {
  return viewer === 'organiser';
}

/**
 * AC1: the places remaining, never below zero (SCRUM-182: a capacity lowered
 * below the number registered keeps everyone). Null while no capacity is set.
 */
export function placesRemaining(capacity: number | null, registered: number): number | null {
  return capacity === null ? null : Math.max(capacity - registered, 0);
}

/** AC1: only Registered rows count; a withdrawn one gave its place back (SCRUM-182 AC3). */
export function registeredCount(entries: readonly { status: string }[]): number {
  return entries.filter((entry) => entry.status === 'registered').length;
}

/** The registration date as the list and the export show it: DD/MM/YYYY, Singapore. */
export function registrationDate(registeredAt: string): string {
  return formatDayMonthYear(toSingaporeISODate(new Date(registeredAt)));
}

export const EXPORT_HEADERS = ['Reference', 'Full name', 'Email', 'Contact number', 'Registration date', 'Status'];

/**
 * A spreadsheet treats a cell starting with =, +, - or @ as a formula, and an
 * attendee types their own name and number, so such a cell is opened with a
 * quote. That includes a contact number like +65 9123 4567, which a
 * spreadsheet would otherwise try to work out (and show as an error).
 */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** AC2: the attendee information as CSV, one row per registration, in list order. */
export function registrationListCsv(entries: readonly RegistrationListEntry[]): string {
  const rows = entries.map((entry) => [
    entry.reference,
    entry.fullName,
    entry.email,
    entry.contactNumber,
    registrationDate(entry.registeredAt),
    REGISTRATION_STATUS_LABELS[entry.status],
  ]);
  return [EXPORT_HEADERS, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** The export's file name, from the event's reference (letters, digits and dashes only). */
export function exportFileName(reference: string): string {
  return `registrations-${reference.replace(/[^A-Za-z0-9-]/g, '')}.csv`;
}

export const NO_ACCESS_MESSAGE = "You don't have access to this event's registration list.";
export const EXPORT_NOT_ALLOWED_MESSAGE =
  'Only the Event Organiser responsible for this event can export its registration list.';
