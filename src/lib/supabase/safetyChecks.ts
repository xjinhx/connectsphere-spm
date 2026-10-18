import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './admin';
import type { Database } from './database.types';

/**
 * Safety check queries (SCRUM-234 Run the Operational Safety Check).
 *
 * Same rules as the other files here: the client and the query building live
 * in this file, src/domain/safety-check/service.ts decides when to run them,
 * and each function returns the raw Supabase result.
 *
 * Reads and writes go through the service-role client, so the deny-all RLS on
 * safety_check is a backstop and the rules are decided in the service.
 */

function db(): SupabaseClient<Database> {
  return createAdminClient();
}

/**
 * AC1: every Confirmed event, earliest first, with its confirmed bookings'
 * venues for the list. Confirmed is "awaiting a check": a decision moves the
 * event out of it (AC3-AC5), and one confirmed again is awaiting a new one.
 */
export async function fetchEventsAwaitingSafetyCheck() {
  return db()
    .from('event_request')
    .select(
      'id, reference, name, proposed_date, start_time, end_time, expected_attendance, ' +
        'client_organisation:client_organisations ( name ), ' +
        'venue_booking ( status, venue:venue_id ( name ) )',
    )
    .eq('status', 'confirmed')
    .order('proposed_date', { ascending: true, nullsFirst: false })
    .order('reference');
}

/**
 * AC2: an event's confirmed bookings, each with its venue's capacity and
 * layouts and the venue requirements of the request it was booked from
 * (SCRUM-230), so the check can show the layout and attendance in use.
 */
export async function fetchConfirmedBookingsForSafetyCheck(eventRequestId: string) {
  return db()
    .from('venue_booking')
    .select(
      'id, date, start_time, end_time, ' +
        'venue:venue_id ( id, name, max_capacity, venue_layouts ( layout, capacity ) ), ' +
        'request_line:request_line_id ( request:request_id ( id, expected_attendance, room_layout, accessibility_required, accessibility_notes ) )',
    )
    .eq('event_request_id', eventRequestId)
    .eq('status', 'confirmed')
    .order('date')
    .order('start_time');
}

/** AC3-AC5: the event's safety checks, newest first. */
export async function fetchSafetyChecks(eventRequestId: string) {
  return db()
    .from('safety_check')
    .select('id, decision, note, decided_by, decided_at')
    .eq('event_request_id', eventRequestId)
    .order('decided_at', { ascending: false })
    .order('id');
}

/**
 * AC3-AC6: one call to record_safety_check
 * (20261018030100_operational_safety_check.sql), which records the decision
 * and moves the event in one transaction. Resolves to 'recorded', or
 * 'not_confirmed' when the event is not Confirmed and nothing changed.
 */
export async function recordSafetyCheck(check: {
  eventRequestId: string;
  decision: 'approved' | 'changes_requested' | 'rejected';
  note: string | null;
  decidedBy: string;
}) {
  return db().rpc('record_safety_check', {
    p_event_request_id: check.eventRequestId,
    p_decision: check.decision,
    // The generated type says string; the column takes null for an approval.
    p_note: check.note as string,
    p_decided_by: check.decidedBy,
  });
}
