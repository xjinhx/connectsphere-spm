import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './admin';
import type { Database } from './database.types';

/**
 * Venue bookings (SCRUM-148): deciding a booking request's lines, and reading
 * a venue's confirmed bookings for its calendar.
 *
 * Same rules as the other files here: the client and the query building live
 * in this file, src/domain/venue-booking/service.ts decides when to run them,
 * and each function returns the raw Supabase result.
 */

/** createAdminClient memoises its client, so calling it per query is free. */
function db(): SupabaseClient<Database> {
  return createAdminClient();
}

/** AC1 and AC5: a request with its event's coordinator and every line's decision. */
export async function fetchVenueBookingDecision(id: string) {
  return db()
    .from('venue_booking_request')
    .select(
      'id, event_request_id, venue_id, event_request:event_request_id (coordinator_id), venue_booking_request_line (id, date, time_slots, status, decided_by, decided_at, rejection_reason)',
    )
    .eq('id', id)
    .maybeSingle();
}

/**
 * AC1, AC2 and AC5: one call to decide_venue_booking_request
 * (20261006100000_venue_booking_decision.sql), which records every line's
 * decision and creates a confirmed booking per approved slot in one
 * transaction. supabase-js has no transactions of its own.
 *
 * Resolves to 'decided', 'already_decided' or 'incomplete'. A slot that already
 * holds a confirmed booking fails the whole call with a unique violation.
 */
export async function decideVenueBookingRequestLines(
  requestId: string,
  decisions: readonly { lineId: string; decision: 'approve' | 'reject'; reason?: string }[],
  decidedBy: string,
) {
  return db().rpc('decide_venue_booking_request', {
    p_request_id: requestId,
    p_decisions: decisions.map((d) => ({ line_id: d.lineId, decision: d.decision, reason: d.reason ?? null })),
    p_decided_by: decidedBy,
  });
}

/**
 * SCRUM-92's approval view (D-02's venue part, replaced by SCRUM-148): how many
 * confirmed bookings an event holds. The count only; no rows come back.
 */
export async function countConfirmedBookingsForEvent(eventRequestId: string) {
  return db()
    .from('venue_booking')
    .select('id', { count: 'exact', head: true })
    .eq('event_request_id', eventRequestId)
    .eq('status', 'confirmed');
}

/** AC3 and AC4: a venue's confirmed bookings from `from` to `to` (YYYY-MM-DD), with each booking's event. */
export async function fetchConfirmedBookingsBetween(venueId: string, from: string, to: string) {
  return db()
    .from('venue_booking')
    .select('date, slot, event_request:event_request_id (id, reference, name, coordinator_id)')
    .eq('venue_id', venueId)
    .eq('status', 'confirmed')
    .gte('date', from)
    .lte('date', to)
    .order('date');
}
