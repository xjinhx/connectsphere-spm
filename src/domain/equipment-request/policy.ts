import type { EventRequestStatus } from '@/domain/event-request/schema';

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
