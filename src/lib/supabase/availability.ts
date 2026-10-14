import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './admin';
import type { Database } from './database.types';

/**
 * Venue availability queries (EP-13): the unavailable periods Venue Staff
 * record (SCRUM-151, in times since SCRUM-239 AC6).
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
 * it as a stand-in for SCRUM-151 (dummy D-09). Since SCRUM-239 AC6 a row is a
 * period, start_time to end_time; `slot` is only set on rows from before.
 */
const UNAVAILABLE_PERIOD_SELECT = 'id, venue_id, date, start_time, end_time, reason, created_at';

/**
 * SCRUM-239 AC6, SCRUM-151 AC1 and AC2: one call to the database function
 * mark_period_unavailable (migration 20261013110100_...), which records the
 * period and a notice for each affected booking's coordinator in a single
 * transaction. supabase-js has no transactions of its own.
 *
 * If the period overlaps one already recorded (exclusion constraint, 23P01)
 * the whole call fails and nothing is saved. Resolves to the notices written,
 * a jsonb array (NoticeWrittenSchema). `today` is the Singapore date
 * (YYYY-MM-DD) "upcoming" is judged against; left out, the function works it
 * out itself.
 */
export async function recordUnavailablePeriod(input: {
  venueId: string;
  date: string;
  start: string;
  end: string;
  reason: string;
  recordedBy: string;
  today?: string;
}) {
  return db().rpc('mark_period_unavailable', {
    p_venue_id: input.venueId,
    p_date: input.date,
    p_start: input.start,
    p_end: input.end,
    p_reason: input.reason,
    p_recorded_by: input.recordedBy,
    ...(input.today !== undefined && { p_today: input.today }),
  });
}

/** The venue's unavailable periods on one date. */
export async function fetchUnavailablePeriodsOn(venueId: string, date: string) {
  return db().from('venue_unavailable_slot').select(UNAVAILABLE_PERIOD_SELECT).eq('venue_id', venueId).eq('date', date);
}

/**
 * SCRUM-151 AC3, by time: the event's affected bookings on or after `today`, a
 * Singapore date (YYYY-MM-DD), from the affected_booking_slot view. One row
 * per booking and overlapping unavailable period, with the venue's name.
 */
export async function fetchAffectedBookingsForEvent(eventRequestId: string, today: string) {
  return db()
    .from('affected_booking_slot')
    .select(
      'booking_id, venue_id, slot_date, start_time, end_time, unavailable_start_time, unavailable_end_time, reason, venues ( name )',
    )
    .eq('event_request_id', eventRequestId)
    .gte('slot_date', today);
}

/** The venue's unavailable periods on or after `today`, a Singapore date (YYYY-MM-DD). */
export async function fetchUpcomingUnavailablePeriods(venueId: string, today: string) {
  return db().from('venue_unavailable_slot').select(UNAVAILABLE_PERIOD_SELECT).eq('venue_id', venueId).gte('date', today);
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

/** SCRUM-239: a venue's unavailable periods from `fromDate` to `toDate` (inclusive), with their reasons. */
export async function fetchUnavailablePeriods(venueId: string, fromDate: string, toDate: string) {
  return db()
    .from('venue_unavailable_slot')
    .select('venue_id, date, start_time, end_time, reason')
    .eq('venue_id', venueId)
    .gte('date', fromDate)
    .lte('date', toDate);
}
