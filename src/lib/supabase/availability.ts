import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './admin';
import type { Database } from './database.types';

/**
 * Venue availability queries (EP-13): the unavailable slots Venue Staff
 * record (SCRUM-151).
 *
 * Same rules as venues.ts: the client and the query building live here, and
 * src/domain/availability/service.ts only calls these functions. Each returns
 * the raw Supabase result; error mapping is the service's job.
 */

/** createAdminClient memoises its client, so calling it per query is free. */
function db(): SupabaseClient<Database> {
  return createAdminClient();
}

/**
 * venue_unavailable_slot is shared with SCRUM-128's venue search, which created
 * it as a stand-in for this story (dummy D-09). SCRUM-151 writes it and adds
 * recorded_by; the other columns are SCRUM-128's names.
 */
const UNAVAILABLE_SLOT_SELECT = 'id, venue_id, date, slot, reason, created_at';

/**
 * SCRUM-151 AC1 and AC2: one call to the database function
 * mark_slots_unavailable (migration 20261007120000_...), which records one
 * row per slot and a notice for each affected booking's coordinator in a
 * single transaction. supabase-js has no transactions of its own.
 *
 * If any of the slots is already unavailable (the unique constraint) the
 * whole call fails and nothing is saved. Resolves to the notices written, a
 * jsonb array (NoticeWrittenSchema). `today` is the Singapore date (YYYY-MM-DD) "upcoming" is judged
 * against; left out, the function works it out itself.
 */
export async function recordUnavailableSlots(input: {
  venueId: string;
  date: string;
  slots: string[];
  reason: string;
  recordedBy: string;
  today?: string;
}) {
  return db().rpc('mark_slots_unavailable', {
    p_venue_id: input.venueId,
    p_slot_date: input.date,
    p_slots: input.slots,
    p_reason: input.reason,
    p_recorded_by: input.recordedBy,
    ...(input.today !== undefined && { p_today: input.today }),
  });
}

/** The venue's unavailable slots on one date, among `slots`. */
export async function fetchUnavailableSlotsOn(venueId: string, date: string, slots: readonly string[]) {
  return db()
    .from('venue_unavailable_slot')
    .select(UNAVAILABLE_SLOT_SELECT)
    .eq('venue_id', venueId)
    .eq('date', date)
    .in('slot', [...slots]);
}

/**
 * SCRUM-151 AC3: the event's affected bookings on or after `today`, a
 * Singapore date (YYYY-MM-DD), from the affected_booking_slot view added by
 * AC2. One row per affected slot, with the venue's name.
 */
export async function fetchAffectedBookingSlotsForEvent(eventRequestId: string, today: string) {
  return db()
    .from('affected_booking_slot')
    .select('booking_id, venue_id, slot_date, slot, reason, venues ( name )')
    .eq('event_request_id', eventRequestId)
    .gte('slot_date', today);
}

/** The venue's unavailable slots on or after `today`, a Singapore date (YYYY-MM-DD). */
export async function fetchUpcomingUnavailableSlots(venueId: string, today: string) {
  return db()
    .from('venue_unavailable_slot')
    .select(UNAVAILABLE_SLOT_SELECT)
    .eq('venue_id', venueId)
    .gte('date', today);
}

/**
 * SCRUM-239: a venue's confirmed bookings from `fromDate` to `toDate`
 * (YYYY-MM-DD, inclusive), with their start and end times. For
 * getVenueCommitments; the time-range check itself is the service's.
 */
export async function fetchConfirmedBookingPeriods(venueId: string, fromDate: string, toDate: string) {
  return db()
    .from('venue_booking')
    .select('venue_id, event_request_id, date, start_time, end_time')
    .eq('venue_id', venueId)
    .eq('status', 'confirmed')
    .gte('date', fromDate)
    .lte('date', toDate);
}

/**
 * SCRUM-226: the venue's setup and turnaround in minutes, so getVenueCommitments
 * can treat them as occupied. Null data for a venue id that doesn't exist.
 */
export async function fetchVenueSetupTurnaround(venueId: string) {
  return db().from('venues').select('setup_minutes, turnaround_minutes').eq('id', venueId).maybeSingle();
}

/** SCRUM-239: a venue's unavailable periods from `fromDate` to `toDate` (inclusive), with their reasons. */
export async function fetchUnavailablePeriods(venueId: string, fromDate: string, toDate: string) {
  return db()
    .from('venue_unavailable_slot')
    .select('venue_id, date, start_time, end_time, reason')
    .eq('venue_id', venueId)
    .gte('date', fromDate)
    .lte('date', toDate);
}
