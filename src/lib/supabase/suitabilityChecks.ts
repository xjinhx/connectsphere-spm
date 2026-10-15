import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './admin';
import type { Database, Json } from './database.types';

/**
 * Venue suitability check queries (SCRUM-135).
 *
 * Same rules as venues.ts: the client and the query building live here, and
 * src/domain/suitability/service.ts only calls these functions. Each returns
 * the raw Supabase result; error mapping is the service's job.
 */

/** createAdminClient memoises its client, so calling it per query is free. */
function db(): SupabaseClient<Database> {
  return createAdminClient();
}

/** AC3: store one run of a check. Returns the time it was stored. */
export async function insertSuitabilityCheck(check: {
  eventRequestId: string;
  venueId: string;
  /** SCRUM-136 AC5: the booking request checked for, or null for the event itself. */
  bookingRequestId: string | null;
  verdict: string;
  requirements: Json;
  needs: Json;
  checkedBy: string;
}) {
  return db()
    .from('venue_suitability_check')
    .insert({
      event_request_id: check.eventRequestId,
      venue_id: check.venueId,
      venue_booking_request_id: check.bookingRequestId,
      verdict: check.verdict,
      requirements: check.requirements,
      needs: check.needs,
      checked_by: check.checkedBy,
    })
    .select('checked_at')
    .single();
}

/** AC3: every stored check for an event, newest first, with each venue's name and the request it was for. */
export async function fetchSuitabilityChecks(eventRequestId: string) {
  return db()
    .from('venue_suitability_check')
    .select('venue_id, venue_booking_request_id, verdict, requirements, needs, checked_at, venues:venue_id!inner (name)')
    .eq('event_request_id', eventRequestId)
    .order('checked_at', { ascending: false });
}
