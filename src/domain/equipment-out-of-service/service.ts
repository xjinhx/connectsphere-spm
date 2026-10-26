import { EquipmentIdSchema } from '@/domain/equipment/schema';
import { NotFoundError, ValidationError, isCheckViolation } from '@/domain/shared/errors';
import { fetchAllOutOfService, fetchItemOutOfService, updateOutOfService } from '@/lib/supabase/equipmentOutOfService';
import { countsOverQuantity } from './policy';
import { ItemOutOfServiceSchema, OutOfServiceCountsSchema, type ItemOutOfService, type OutOfServiceCounts } from './schema';

/**
 * Out-of-service service (SCRUM-170 Exclude equipment that is unavailable,
 * damaged or under maintenance).
 *
 * Orchestration only: queries live in src/lib/supabase/equipmentOutOfService.ts,
 * the rules in policy.ts. Who may record counts (Technical Support Staff,
 * equipment_administration, SCRUM-240 AC3's permission) is checked by the
 * route and the page before anything here is called.
 */

type Row = {
  id: string;
  quantity: number;
  units_unavailable: number;
  units_damaged: number;
  units_under_maintenance: number;
};

function countsOf(row: Row): OutOfServiceCounts {
  return { unavailable: row.units_unavailable, damaged: row.units_damaged, underMaintenance: row.units_under_maintenance };
}

function toItem(row: Row): ItemOutOfService {
  return ItemOutOfServiceSchema.parse({ equipmentId: row.id, quantity: row.quantity, counts: countsOf(row) });
}

/** AC1: every item's counts, by item id, for the catalogue page. */
export async function listOutOfService(): Promise<Map<string, OutOfServiceCounts>> {
  const { data, error } = await fetchAllOutOfService();
  if (error || !data) throw new ValidationError('Could not load the units out of service.', error?.message);
  return new Map((data as Row[]).map((row) => [row.id, countsOf(row)]));
}

/**
 * SCRUM-170: records how many of an item's units are out of service, by
 * status.
 *
 * AC1 the counts are saved against the item, each with its status.
 * AC2 a unit returned to service is a lower count, saved the same way.
 * AC4 fewer than zero is refused on that field; more units than the item has,
 *     in all, is refused on the field that changed. Nothing is saved.
 *
 * Reservations are not touched (AC6): availability is worked out when it is
 * checked, from these counts.
 */
export async function recordOutOfService(equipmentId: string, input: unknown): Promise<ItemOutOfService> {
  const id = EquipmentIdSchema.safeParse(equipmentId);
  if (!id.success) throw new NotFoundError('Equipment item');

  const parsed = OutOfServiceCountsSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'The units are not valid.', parsed.error.flatten());
  }

  const { data: current, error: readError } = await fetchItemOutOfService(id.data);
  if (readError) throw new ValidationError('The equipment item could not be read.', readError.message);
  if (!current) throw new NotFoundError('Equipment item');

  const row = current as Row;
  const over = countsOverQuantity(row.quantity, parsed.data, countsOf(row));
  if (over) {
    const message = Object.values(over)[0]?.[0] ?? 'Too many units out of service.';
    throw new ValidationError(message, { formErrors: [], fieldErrors: over });
  }

  const { data, error } = await updateOutOfService(id.data, parsed.data);
  if (error) {
    // The item's quantity changed between the read and the save: the column
    // checks refuse it, so say so on the form rather than failing blind.
    if (isCheckViolation(error)) {
      throw new ValidationError('The units out of service no longer fit the item. Reload and try again.');
    }
    throw new ValidationError('The units out of service could not be saved.', error.message);
  }
  if (!data) throw new NotFoundError('Equipment item');
  return toItem(data as Row);
}
