import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './admin';
import type { Database } from './database.types';

/**
 * Equipment catalogue queries (SCRUM-240 Maintain the equipment catalogue).
 *
 * Same rules as venues.ts and venueHolds.ts: the client and the query building
 * live here, and src/domain/equipment/service.ts only calls these functions.
 * Each returns the raw Supabase result; error mapping is the service's job.
 *
 * Reads and writes go through the service-role client, so the deny-all RLS on
 * `equipment` is a backstop and AC3's rule is decided in policy.ts.
 */

/** createAdminClient memoises its client, so calling it per query is free. */
function db(): SupabaseClient<Database> {
  return createAdminClient();
}

const EQUIPMENT_SELECT =
  'id, name, category, quantity, current_location, operational_status, created_at, updated_at';

/** AC1: the catalogue, in name order. */
export async function fetchEquipment() {
  return db().from('equipment').select(EQUIPMENT_SELECT).order('name');
}

/** One item. maybeSingle: a missing id is null, not an error. */
export async function fetchEquipmentById(equipmentId: string) {
  return db().from('equipment').select(EQUIPMENT_SELECT).eq('id', equipmentId).maybeSingle();
}

/** AC5: the ids the catalogue holds, out of the ids a requirement names. */
export async function fetchEquipmentIdsIn(equipmentIds: readonly string[]) {
  return db().from('equipment').select('id').in('id', [...equipmentIds]);
}

/** AC1: record an item. Returns the saved row. */
export async function insertEquipment(item: {
  name: string;
  category: string;
  quantity: number;
  currentLocation: string;
  createdBy: string;
}) {
  return db()
    .from('equipment')
    .insert({
      name: item.name,
      category: item.category,
      quantity: item.quantity,
      current_location: item.currentLocation,
      created_by: item.createdBy,
    })
    .select(EQUIPMENT_SELECT)
    .single();
}

/**
 * AC2, AC4: change an item. Only the columns the caller passes are sent, so a
 * status change leaves the quantity and location alone (TC-240-06).
 * equipment_touch_updated_at keeps updated_at in step.
 */
export async function updateEquipmentRow(
  equipmentId: string,
  changes: {
    name?: string;
    category?: string;
    quantity?: number;
    current_location?: string;
    operational_status?: string;
  },
) {
  return db().from('equipment').update(changes).eq('id', equipmentId).select(EQUIPMENT_SELECT).maybeSingle();
}
