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

export type UnavailableSlotInsert = {
  venueId: string;
  date: string;
  slot: string;
  reason: string;
  recordedBy: string;
};

/**
 * SCRUM-151 AC1: one row per ticked slot, in a single insert. Postgres runs a
 * statement as one unit, so if any of the slots is already unavailable (the
 * unique constraint) none of them is saved.
 */
export async function insertUnavailableSlots(rows: UnavailableSlotInsert[]) {
  return db()
    .from('venue_unavailable_slot')
    .insert(
      rows.map((row) => ({
        venue_id: row.venueId,
        slot_date: row.date,
        slot: row.slot,
        reason: row.reason,
        recorded_by: row.recordedBy,
      })),
    )
    .select(UNAVAILABLE_SLOT_SELECT);
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
