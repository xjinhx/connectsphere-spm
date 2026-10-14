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

const LINE_COLUMNS = 'id, date, start_time, end_time, status';
const REQUEST_COLUMNS = `id, event_request_id, venue_id, requested_by, created_at, venue_booking_request_line ( ${LINE_COLUMNS} )`;

export interface VenueBookingRequestLineRow {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
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
 * transaction (create_venue_booking_request(), as SCRUM-239 left it in
 * 20261012090000_booking_requests_in_time_ranges.sql). Each line is a date
 * and a start and end time. Returns the new request's id.
 *
 * SCRUM-230 AC1: the request's own venue requirements go with it
 * (20261014114328_booking_request_venue_requirements.sql). Null is "use the
 * event's" (AC2), and is left out so the function's default applies.
 */
export async function createVenueBookingRequest(input: {
  eventRequestId: string;
  venueId: string;
  requestedBy: string;
  lines: readonly { date: string; start: string; end: string }[];
  expectedAttendance: number | null;
  roomLayout: string | null;
  accessibilityRequired: boolean | null;
  accessibilityNotes: string | null;
}) {
  return db().rpc('create_venue_booking_request', {
    p_event_request_id: input.eventRequestId,
    p_venue_id: input.venueId,
    p_requested_by: input.requestedBy,
    p_lines: input.lines.map((line) => ({ date: line.date, start: line.start, end: line.end })),
    p_expected_attendance: input.expectedAttendance ?? undefined,
    p_room_layout: input.roomLayout ?? undefined,
    p_accessibility_required: input.accessibilityRequired ?? undefined,
    p_accessibility_notes: input.accessibilityNotes ?? undefined,
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
  start_time: string;
  end_time: string;
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
      'id, date, start_time, end_time, venue_booking_request ( id, created_at, venues ( name ), event_request ( name, reference ) )',
    )
    .eq('status', 'pending');
}

// ---------------------------------------------------------------------------
// SCRUM-143 — Include the requirements Venue Staff need
// ---------------------------------------------------------------------------

/** A booking request's event, as recorded, and who requested it. */
export interface BookingRequestRequirementsRow {
  id: string;
  created_at: string;
  requested_by: string;
  // SCRUM-230: the request's own venue requirements; null is "use the event's".
  expected_attendance: number | null;
  room_layout: string | null;
  accessibility_required: boolean | null;
  accessibility_notes: string | null;
  event_request: {
    name: string;
    reference: string;
    expected_attendance: number | null;
    room_layout: string | null;
    accessibility_required: boolean | null;
    accessibility_notes: string | null;
    event_request_accessibility_features: { accessibility_features: { name: string } | null }[];
  } | null;
}

/** AC1, AC2 — the event behind a booking request, with its requirements as recorded on the event. */
export async function fetchBookingRequestRequirements(id: string) {
  return db()
    .from('venue_booking_request')
    .select(
      'id, created_at, requested_by, expected_attendance, room_layout, accessibility_required, accessibility_notes, ' +
        'event_request ( name, reference, expected_attendance, room_layout, accessibility_required, accessibility_notes, ' +
        'event_request_accessibility_features ( accessibility_features ( name ) ) )',
    )
    .eq('id', id)
    .maybeSingle();
}
