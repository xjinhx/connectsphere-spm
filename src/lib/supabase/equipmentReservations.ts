import { createAdminClient } from './admin';

/**
 * Equipment availability and reservation queries (SCRUM-167, SCRUM-173).
 *
 * Same rules as equipmentRequests.ts: the client and the query building live
 * here, src/domain/equipment-reservation/service.ts decides when to run them,
 * and each returns the raw Supabase result.
 */

function db() {
  return createAdminClient();
}

/** 167 AC1, AC3: the dates of the event's confirmed venue bookings (a released one no longer counts). */
export async function fetchConfirmedBookingDates(eventRequestId: string) {
  return db().from('venue_booking').select('date').eq('event_request_id', eventRequestId).eq('status', 'confirmed');
}

/** 167 AC4: the event's request lines, in the order they were added, with each item's name and quantity. */
export async function fetchLinesWithItems(eventRequestId: string) {
  return db()
    .from('equipment_request_line')
    .select('id, equipment_id, quantity, equipment ( name, quantity )')
    .eq('event_request_id', eventRequestId)
    .order('created_at')
    .order('id');
}

/** 173 AC6: the event's reservations, Reserved and Released, oldest first, with each item's name. */
export async function fetchEventReservations(eventRequestId: string) {
  return db()
    .from('equipment_reservation')
    .select('id, line_id, equipment_id, quantity, window_start, window_end, status, created_at, review_required, review_required_at, review_required_cause, equipment ( name )')
    .eq('event_request_id', eventRequestId)
    .order('created_at')
    .order('id');
}

/**
 * 167 AC5: every reservation still held of `equipmentIds` by an event other
 * than `eventRequestId` that shares at least one day with `window` (inclusive
 * at both ends). The event's own are not counted against it (AC4).
 */
export async function fetchOtherEventsReservations(
  eventRequestId: string,
  equipmentIds: readonly string[],
  window: { start: string; end: string },
) {
  return db()
    .from('equipment_reservation')
    .select('equipment_id, quantity, window_start, window_end')
    .in('equipment_id', [...equipmentIds])
    .neq('event_request_id', eventRequestId)
    .eq('status', 'reserved')
    .lte('window_start', window.end)
    .gte('window_end', window.start);
}

/**
 * 173 AC1 to AC5: one call to reserve_equipment, which works out the window,
 * checks what is free with the item locked and reserves, in one transaction.
 * Resolves to {"outcome": ...}; see the migration for each outcome.
 */
export async function reserveEquipmentLine(lineId: string, quantity: number, reservedBy: string) {
  return db().rpc('reserve_equipment', { p_line_id: lineId, p_quantity: quantity, p_reserved_by: reservedBy });
}

/** One reservation, as the service returns it after a reserve. */
export async function fetchReservation(reservationId: string) {
  return db()
    .from('equipment_reservation')
    .select('id, line_id, equipment_id, quantity, window_start, window_end, status, created_at, review_required, review_required_at, review_required_cause, equipment ( name )')
    .eq('id', reservationId)
    .single();
}
