import { isCurrentCoordinator } from '@/domain/assignment/policy';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import { isActionPermitted } from '@/domain/identity/permissions';
import type { Role } from '@/domain/identity/roles';

/**
 * Equipment request rules (SCRUM-160 Record the equipment an event needs).
 * Pure functions: no Supabase, no Next.js.
 */

/**
 * AC1: "Given I am the assigned coordinator of an event that is Approved or in
 * Planning". Any other status does not accept an equipment request edit
 * (TC-160-02) - the same two statuses SCRUM-142 accepts a venue booking request
 * in (canCreateBookingRequest).
 *
 * INTERIM, to confirm at standup (recorded on TC-160-02): Confirmed is refused
 * too, because AC1 names only Approved and Planning.
 */
export function acceptsEquipmentRequest(status: EventRequestStatus): boolean {
  return status === 'approved' || status === 'planning';
}

export const EVENT_NOT_OPEN_FOR_EQUIPMENT_MESSAGE =
  'Equipment can only be requested for an event that is Approved or in Planning.';

/**
 * AC3: "Given I add the same equipment type a second time on the same event,
 * when I save, then a separate line is created and the existing line is shown
 * to me so that I can merge them if that was my intent; lines are never merged
 * automatically."
 *
 * The event's other lines that name the same catalogue item as `added`, in the
 * order given. Empty for a type the event has not asked for before (TC-160-09).
 * Only the request it is given is searched, so the same type on another event
 * is never reported (AC3 says "on the same event").
 */
export function linesOfSameType<T extends { id: string; equipmentId: string }>(
  lines: readonly T[],
  added: { id: string; equipmentId: string },
): T[] {
  return lines.filter((line) => line.id !== added.id && line.equipmentId === added.equipmentId);
}

/**
 * Who may open an event's equipment request.
 *
 * AC6: "Given technical requirements have been entered, when Technical Support
 * Staff open the request, then the notes are displayed with the equipment
 * list" - they hold equipment_request_view. The event's assigned coordinator,
 * who records it, may open it too. Nobody else: access follows role and
 * relationship to the event (customer clarification #91), so a coordinator the
 * event is not assigned to is refused, as for every edit (AC4).
 */
export function canViewEquipmentRequest(
  actor: { userId: string; roles: readonly Role[] },
  eventCoordinatorId: string | null,
): boolean {
  return (
    isActionPermitted(actor.roles, 'equipment_request_view') || isCurrentCoordinator(eventCoordinatorId, actor.userId)
  );
}
