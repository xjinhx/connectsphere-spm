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
      'id, event_request_id, venue_id, event_request:event_request_id (coordinator_id), venue_booking_request_line (id, date, start_time, end_time, time_slots, status, decided_by, decided_at, rejection_reason, suggested_venue_id, suggested_date, suggested_start_time, suggested_end_time, suggested_slots, suggested_venue:suggested_venue_id (name))',
    )
    .eq('id', id)
    .maybeSingle();
}

/**
 * AC1, AC2 and AC5: one call to decide_venue_booking_request
 * (as SCRUM-239 left it in 20261012090000_booking_requests_in_time_ranges.sql),
 * which records every line's decision and creates a confirmed booking for each
 * approved line's period in one transaction. supabase-js has no transactions
 * of its own.
 *
 * Resolves to {"outcome": ..., "autoRejectedRequestIds": [...]} (SCRUM-155).
 * A period that overlaps a confirmed booking fails the whole call with an
 * exclusion violation (venue_booking_no_overlap).
 */
export async function decideVenueBookingRequestLines(
  requestId: string,
  decisions: readonly {
    lineId: string;
    decision: 'approve' | 'reject';
    reason?: string;
    suggestion?: { venueId: string; date: string; start: string; end: string };
  }[],
  decidedBy: string,
) {
  return db().rpc('decide_venue_booking_request', {
    p_request_id: requestId,
    p_decisions: decisions.map((d) => ({
      line_id: d.lineId,
      decision: d.decision,
      reason: d.reason ?? null,
      // SCRUM-150 AC1: saved on the rejected line with the decision.
      suggestion: d.suggestion
        ? { venue_id: d.suggestion.venueId, date: d.suggestion.date, start: d.suggestion.start, end: d.suggestion.end }
        : null,
    })),
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

/** AC3 and AC4: a venue's confirmed bookings from `from` to `to` (YYYY-MM-DD), with each booking's times and event. */
export async function fetchConfirmedBookingsBetween(venueId: string, from: string, to: string) {
  return db()
    .from('venue_booking')
    .select('date, start_time, end_time, event_request:event_request_id (id, reference, name, coordinator_id)')
    .eq('venue_id', venueId)
    .eq('status', 'confirmed')
    .gte('date', from)
    .lte('date', to)
    .order('date');
}

// -----------------------------------------------------------------------------
// SCRUM-231 — Release one venue booking
// -----------------------------------------------------------------------------

/**
 * AC1, AC2: an event's bookings, released ones included, with the event's
 * coordinator (AC3). SCRUM-229 AC4: with the decisions on any replacement
 * request that names the booking.
 */
export async function fetchEventVenueBookings(eventRequestId: string) {
  return db()
    .from('venue_booking')
    .select(
      'id, date, start_time, end_time, status, release_reason, venue:venue_id (name), event_request:event_request_id (coordinator_id), replacements:venue_booking_request!venue_booking_request_replaces_booking_id_fkey ( venue_booking_request_line ( status ) )',
    )
    .eq('event_request_id', eventRequestId)
    .order('date')
    .order('start_time');
}

/** AC3: a booking with its event's assigned coordinator, to check who may release it. */
export async function fetchVenueBookingForRelease(bookingId: string) {
  return db()
    .from('venue_booking')
    .select('id, event_request:event_request_id (coordinator_id)')
    .eq('id', bookingId)
    .maybeSingle();
}

/**
 * AC1: releases a booking that is still confirmed. A booking already released
 * (a second click, another tab) is not changed and no row comes back.
 */
export async function releaseConfirmedVenueBooking(bookingId: string, release: { reason: string; releasedBy: string }) {
  return db()
    .from('venue_booking')
    .update({
      status: 'released',
      release_reason: release.reason,
      released_by: release.releasedBy,
      released_at: new Date().toISOString(),
    })
    .eq('id', bookingId)
    .eq('status', 'confirmed')
    .select('id')
    .maybeSingle();
}
