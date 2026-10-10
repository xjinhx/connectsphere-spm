import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './admin';
import type { Database } from './database.types';

/**
 * Venue hold queries (SCRUM-227 Hold a venue until an expiry).
 *
 * Same rules as venues.ts: the client and the query building live here, and
 * src/domain/venue-hold/service.ts only calls these functions. Each returns
 * the raw Supabase result; error mapping is the service's job.
 *
 * "Active" in a read means status 'active' and an expiry after `now`: a hold
 * past its expiry commits nothing (AC6), whatever its status says
 * (20261010130000_venue_hold.sql).
 */

/** createAdminClient memoises its client, so calling it per query is free. */
function db(): SupabaseClient<Database> {
  return createAdminClient();
}

const HOLD_SELECT =
  'id, venue_id, event_request_id, date, start_time, end_time, expires_at, status, closed_at, created_at, event_request:event_request_id!inner (reference, name)';

/** AC1: record a hold. Returns the new row's id. */
export async function insertVenueHold(hold: {
  venueId: string;
  eventRequestId: string;
  date: string;
  start: string;
  end: string;
  expiresAt: string;
  createdBy: string;
}) {
  return db()
    .from('venue_hold')
    .insert({
      venue_id: hold.venueId,
      event_request_id: hold.eventRequestId,
      date: hold.date,
      start_time: hold.start,
      end_time: hold.end,
      expires_at: hold.expiresAt,
      created_by: hold.createdBy,
    })
    .select('id')
    .single();
}

/** One hold with its event's reference and name. maybeSingle: a missing id is null, not an error. */
export async function fetchVenueHoldById(holdId: string) {
  return db().from('venue_hold').select(HOLD_SELECT).eq('id', holdId).maybeSingle();
}

/**
 * AC3, AC4, AC6: a venue's active holds from `fromDate` to `toDate`
 * (YYYY-MM-DD, inclusive) that have not expired by `now` (an ISO instant), for
 * getVenueCommitments.
 */
export async function fetchActiveHoldPeriods(venueId: string, fromDate: string, toDate: string, now: string) {
  return db()
    .from('venue_hold')
    .select('venue_id, event_request_id, date, start_time, end_time, expires_at')
    .eq('venue_id', venueId)
    .eq('status', 'active')
    .gt('expires_at', now)
    .gte('date', fromDate)
    .lte('date', toDate);
}

/** The venue page's list: active, unexpired holds on or after `today`, soonest first. */
export async function fetchUpcomingActiveHolds(venueId: string, today: string, now: string) {
  return db()
    .from('venue_hold')
    .select(HOLD_SELECT)
    .eq('venue_id', venueId)
    .eq('status', 'active')
    .gt('expires_at', now)
    .gte('date', today)
    .order('date')
    .order('start_time');
}

/** An event's status, to check it can be held. */
export async function fetchEventStatus(eventRequestId: string) {
  return db().from('event_request').select('id, status').eq('id', eventRequestId).maybeSingle();
}

type EventStatus = Database['public']['Tables']['event_request']['Row']['status'];

/** The events a hold can be placed for (Approved or Planning), for the form's list. */
export async function fetchEventsInStatuses(statuses: readonly EventStatus[]) {
  return db()
    .from('event_request')
    .select('id, reference, name')
    .in('status', [...statuses])
    .order('reference');
}

/** References and names for the events behind a set of commitments, for Venue Staff's messages. */
export async function fetchEventNames(eventRequestIds: readonly string[]) {
  return db().from('event_request').select('id, reference, name').in('id', [...eventRequestIds]);
}
