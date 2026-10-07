import { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './admin';

/**
 * Supabase access for venue booking requests (SCRUM-142). Thin by design: the
 * query/write lives here, the decision about whether to run it lives in
 * src/domain/venue-booking/service.ts.
 */

/** createAdminClient memoises its client, so calling it per query is free. */
function db(): SupabaseClient {
  return createAdminClient();
}

const LINE_COLUMNS = 'id, date, time_slots, status';
const REQUEST_COLUMNS = `id, event_request_id, venue_id, requested_by, created_at, venue_booking_request_line ( ${LINE_COLUMNS} )`;

export interface VenueBookingRequestLineRow {
  id: string;
  date: string;
  time_slots: string[];
  status: 'pending' | 'approved' | 'rejected';
}

export interface VenueBookingRequestRow {
  id: string;
  event_request_id: string;
  venue_id: string;
  requested_by: string;
  created_at: string;
  venue_booking_request_line: VenueBookingRequestLineRow[];
}

/**
 * AC1, AC3 — create the request and every one of its lines in one
 * transaction (create_venue_booking_request(),
 * 20261006090000_venue_booking_request.sql). Returns the new request's id.
 */
export async function createVenueBookingRequest(input: {
  eventRequestId: string;
  venueId: string;
  requestedBy: string;
  lines: readonly { date: string; timeSlots: readonly string[] }[];
}) {
  return db().rpc('create_venue_booking_request', {
    p_event_request_id: input.eventRequestId,
    p_venue_id: input.venueId,
    p_requested_by: input.requestedBy,
    p_lines: input.lines.map((line) => ({ date: line.date, time_slots: line.timeSlots })),
  });
}

/** AC1/AC3 — read a request back with every line on it, for the outcome the coordinator sees. */
export async function fetchVenueBookingRequestById(id: string) {
  return db().from('venue_booking_request').select(REQUEST_COLUMNS).eq('id', id).maybeSingle();
}

// ---------------------------------------------------------------------------
// SCRUM-147 — View the pending booking request queue
// ---------------------------------------------------------------------------

/** One pending line, with the request, venue and event it belongs to. */
export interface PendingBookingLineRow {
  id: string;
  date: string;
  time_slots: string[];
  venue_booking_request: {
    id: string;
    created_at: string;
    venues: { name: string } | null;
    event_request: { name: string; reference: string } | null;
  } | null;
}

/**
 * AC1, AC3, AC4 — every line still pending, at every venue.
 *
 * Only 'pending' lines are read, so a decided line (approved or rejected)
 * drops out of the queue (AC3). No venue filter: Venue Staff are not scoped to
 * particular venues (AC4).
 */
export async function fetchPendingBookingLines() {
  return db()
    .from('venue_booking_request_line')
    .select(
      'id, date, time_slots, venue_booking_request ( id, created_at, venues ( name ), event_request ( name, reference ) )',
    )
    .eq('status', 'pending');
}
