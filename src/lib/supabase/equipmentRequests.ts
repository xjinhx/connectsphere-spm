import { createAdminClient } from './admin';

/**
 * Equipment request queries (SCRUM-160 Record the equipment an event needs).
 *
 * Same rules as equipment.ts: the client and the query building live here, and
 * src/domain/equipment-request/service.ts only calls these functions. Each
 * returns the raw Supabase result; error mapping is the service's job.
 *
 * Reads and writes go through the service-role client, so the deny-all RLS on
 * these tables is a backstop and the rules are decided in the service.
 */

function db() {
  return createAdminClient();
}

/** A line with the catalogue item it names, so the request can show the item's name. */
const LINE_SELECT =
  'id, event_request_id, equipment_id, quantity, created_at, equipment ( name, category )';

/** The event's request, or null when no line has been added yet. */
export async function fetchEquipmentRequest(eventRequestId: string) {
  return db()
    .from('equipment_request')
    .select('event_request_id')
    .eq('event_request_id', eventRequestId)
    .maybeSingle();
}

/** AC1: the request's lines, in the order they were added. */
export async function fetchEquipmentRequestLines(eventRequestId: string) {
  return db()
    .from('equipment_request_line')
    .select(LINE_SELECT)
    .eq('event_request_id', eventRequestId)
    .order('created_at')
    .order('id');
}

/**
 * Creates the event's request if it does not exist yet. ignoreDuplicates: a
 * request that already exists is left as it is.
 */
export async function ensureEquipmentRequest(eventRequestId: string) {
  return db()
    .from('equipment_request')
    .upsert({ event_request_id: eventRequestId }, { onConflict: 'event_request_id', ignoreDuplicates: true });
}

/** AC1: adds one line to the event's request. Returns the saved line. */
export async function insertEquipmentRequestLine(line: {
  eventRequestId: string;
  equipmentId: string;
  quantity: number;
  createdBy: string;
}) {
  return db()
    .from('equipment_request_line')
    .insert({
      event_request_id: line.eventRequestId,
      equipment_id: line.equipmentId,
      quantity: line.quantity,
      created_by: line.createdBy,
    })
    .select(LINE_SELECT)
    .single();
}
