import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './admin';
import type { Database } from './database.types';

/**
 * Suitability check queries (SCRUM-136 Flag a venue whose capacity is
 * exceeded).
 *
 * Same rules as venues.ts: the query building lives here, and
 * src/domain/suitability/service.ts only calls it. Each returns the raw
 * Supabase result; error mapping is the service's job.
 */

/** createAdminClient memoises its client, so calling it per query is free. */
function db(): SupabaseClient<Database> {
  return createAdminClient();
}

/**
 * SCRUM-136 AC5: the booking request a check is for. Its event, to make sure
 * it belongs to the event being checked, and its venue, which is the venue
 * checked. maybeSingle: a missing id is null, not an error.
 */
export async function fetchBookingRequestForCheck(bookingRequestId: string) {
  return db().from('venue_booking_request').select('id, event_request_id, venue_id').eq('id', bookingRequestId).maybeSingle();
}
