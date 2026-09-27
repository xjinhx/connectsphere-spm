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

const UNAVAILABLE_SLOT_SELECT = 'id, venue_id, slot_date, slot, reason, recorded_at';

/**
 * SCRUM-151 AC1 and AC2: one call to the database function
 * mark_slots_unavailable (migration 20260928110000_...), which records one
 * row per slot and a notice for each affected booking's coordinator in a
 * single transaction. supabase-js has no transactions of its own.
 *
 * If any of the slots is already unavailable (the unique constraint) the
 * whole call fails and nothing is saved. Resolves to the number of notices
 * written. `today` is the Singapore date (YYYY-MM-DD) "upcoming" is judged
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
    .eq('slot_date', date)
    .in('slot', [...slots]);
}

/** The venue's unavailable slots on or after `today`, a Singapore date (YYYY-MM-DD). */
export async function fetchUpcomingUnavailableSlots(venueId: string, today: string) {
  return db()
    .from('venue_unavailable_slot')
    .select(UNAVAILABLE_SLOT_SELECT)
    .eq('venue_id', venueId)
    .gte('slot_date', today);
}
