import { createAdminClient } from './admin';

/**
 * Equipment availability queries (SCRUM-167).
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

/** 167 AC4: the event's own reservations, Reserved and Released, oldest first, with each item's name. */
export async function fetchEventReservations(eventRequestId: string) {
  return db()
    .from('equipment_reservation')
    .select('id, line_id, equipment_id, quantity, window_start, window_end, status, created_at, equipment ( name )')
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
