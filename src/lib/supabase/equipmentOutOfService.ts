import { createAdminClient } from './admin';

/**
 * Out-of-service queries (SCRUM-170).
 *
 * Same rules as equipment.ts: the client and the query building live here,
 * src/domain/equipment-out-of-service/service.ts decides when to run them,
 * and each returns the raw Supabase result.
 */

function db() {
  return createAdminClient();
}

const OUT_OF_SERVICE_SELECT = 'id, quantity, units_unavailable, units_damaged, units_under_maintenance';

/** AC1: every item's counts, for the catalogue. */
export async function fetchAllOutOfService() {
  return db().from('equipment').select(OUT_OF_SERVICE_SELECT);
}

/** One item's quantity and counts. maybeSingle: a missing id is null, not an error. */
export async function fetchItemOutOfService(equipmentId: string) {
  return db().from('equipment').select(OUT_OF_SERVICE_SELECT).eq('id', equipmentId).maybeSingle();
}

/** AC1, AC2: replaces the item's three counts. Null when there is no such item. */
export async function updateOutOfService(
  equipmentId: string,
  counts: { unavailable: number; damaged: number; underMaintenance: number },
) {
  return db()
    .from('equipment')
    .update({
      units_unavailable: counts.unavailable,
      units_damaged: counts.damaged,
      units_under_maintenance: counts.underMaintenance,
    })
    .eq('id', equipmentId)
    .select(OUT_OF_SERVICE_SELECT)
    .maybeSingle();
}
