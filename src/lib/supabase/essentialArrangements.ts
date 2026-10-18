import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './admin';
import type { Database } from './database.types';

/**
 * Essential arrangement queries (SCRUM-100 Record which arrangements are
 * essential for an event). The query lives here; whether to run it is decided
 * in src/domain/essential-arrangements/service.ts. Each returns the raw
 * Supabase result; error mapping is the service's job.
 */

function db(): SupabaseClient<Database> {
  return createAdminClient();
}

/** The event's recorded set. maybeSingle: nothing recorded yet is null, not an error. */
export async function fetchEssentialArrangements(eventRequestId: string) {
  return db()
    .from('event_essential_arrangements')
    .select('venue, equipment, technical_support, registration')
    .eq('event_request_id', eventRequestId)
    .maybeSingle();
}

/**
 * AC1, AC3: store the set, replacing any earlier one. The function re-checks
 * the coordinator and status with the event row locked, and returns
 * 'recorded', 'not_found', 'not_assigned', or the status that refused it.
 */
export async function recordEssentialArrangementsRow(
  eventRequestId: string,
  recordedBy: string,
  set: { venue: boolean; equipment: boolean; technicalSupport: boolean; registration: boolean },
) {
  return db().rpc('record_essential_arrangements', {
    p_event_request_id: eventRequestId,
    p_recorded_by: recordedBy,
    p_venue: set.venue,
    p_equipment: set.equipment,
    p_technical_support: set.technicalSupport,
    p_registration: set.registration,
  });
}
