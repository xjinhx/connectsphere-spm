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
    .select('event_request_id, technical_requirements')
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

/** AC7: changes one line's quantity. Null when the event has no such line. */
export async function updateEquipmentRequestLineQuantity(eventRequestId: string, lineId: string, quantity: number) {
  return db()
    .from('equipment_request_line')
    .update({ quantity, updated_at: new Date().toISOString() })
    .eq('event_request_id', eventRequestId)
    .eq('id', lineId)
    .select(LINE_SELECT)
    .maybeSingle();
}

/** AC7: removes one line. Returns the removed line's id, or null when the event has no such line. */
export async function deleteEquipmentRequestLine(eventRequestId: string, lineId: string) {
  return db()
    .from('equipment_request_line')
    .delete()
    .eq('event_request_id', eventRequestId)
    .eq('id', lineId)
    .select('id')
    .maybeSingle();
}

/**
 * AC5: stores the technical requirements with the event's request, creating
 * the request if this is the first thing saved on it.
 */
export async function upsertTechnicalRequirements(eventRequestId: string, technicalRequirements: string | null) {
  return db()
    .from('equipment_request')
    .upsert(
      {
        event_request_id: eventRequestId,
        technical_requirements: technicalRequirements,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'event_request_id' },
    )
    .select('event_request_id, technical_requirements')
    .single();
}

/** One line of the event's request, or null when the event has no such line. */
export async function fetchEquipmentRequestLine(eventRequestId: string, lineId: string) {
  return db()
    .from('equipment_request_line')
    .select(LINE_SELECT)
    .eq('event_request_id', eventRequestId)
    .eq('id', lineId)
    .maybeSingle();
}

/**
 * AC7, AC8: the lines, out of `lineIds`, that have been reserved: those whose
 * reservation is still Reserved (SCRUM-167 gave the table a status).
 *
 * DUMMY(SCRUM-173) D-18: reads equipment_reservation, whose rows are still
 * inserted by hand until SCRUM-173 reserves through the app. SCRUM-173 keeps
 * the signature.
 */
export async function fetchReservedLineIds(lineIds: readonly string[]) {
  return db().from('equipment_reservation').select('line_id').in('line_id', [...lineIds]).eq('status', 'reserved');
}

/**
 * SCRUM-164 AC1, AC3, AC5: every equipment request whose status is one of
 * `statuses`, at every location, with its event and its lines in the order
 * they were added. Which statuses count as outstanding is the domain's call
 * (OUTSTANDING_EQUIPMENT_REQUEST_STATUSES), so they are passed in.
 *
 * DUMMY(SCRUM-166) D-19: status and unavailable are set by hand until
 * SCRUM-166 sets them; this reads them as stored.
 */
const QUEUE_SELECT =
  'event_request_id, status, event_request ( name, reference, proposed_date ), equipment_request_line ( id, quantity, unavailable, created_at, equipment ( name ) )';

export async function fetchEquipmentRequestsByStatus(statuses: readonly string[]) {
  return db()
    .from('equipment_request')
    .select(QUEUE_SELECT)
    .in('status', [...statuses])
    .order('created_at', { referencedTable: 'equipment_request_line' })
    .order('id', { referencedTable: 'equipment_request_line' });
}
