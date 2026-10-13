import {
  fetchEquipment,
  fetchEquipmentById,
  fetchEquipmentIdsIn,
  insertEquipment,
  updateEquipmentRow,
} from '@/lib/supabase/equipment';
import { NotFoundError, ValidationError, isCheckViolation } from '@/domain/shared/errors';
import { assertEquipmentIdsKnown } from './policy';
import {
  CreateEquipmentInputSchema,
  EQUIPMENT_CATEGORIES,
  EquipmentFormOptionsSchema,
  EquipmentIdSchema,
  EquipmentItemSchema,
  EquipmentOptionSchema,
  OPERATIONAL_STATUSES,
  UpdateEquipmentInputSchema,
  type EquipmentFormOptions,
  type EquipmentItem,
  type EquipmentOption,
} from './schema';

/**
 * Equipment catalogue service (SCRUM-240 Maintain the equipment catalogue).
 *
 * Orchestration only: queries live in src/lib/supabase/equipment.ts, the rules
 * in policy.ts, single-field rules in schema.ts. Rows are mapped and then
 * parsed back through the output schemas, so what leaves this file matches the
 * contract the API and the UI expect rather than being cast into shape.
 *
 * Who may add or change an item (AC3) is checked by the route and the page
 * with equipment_administration, before anything here is called. The account
 * recorded against a new item is the signed-in one passed in by the route,
 * never an id from the request body.
 */

type EquipmentRow = {
  id: string;
  name: string;
  category: string;
  quantity: number;
  current_location: string;
  operational_status: string;
  created_at: string;
  updated_at: string;
};

function toEquipmentItem(row: EquipmentRow): EquipmentItem {
  return EquipmentItemSchema.parse({
    id: row.id,
    name: row.name,
    category: row.category,
    quantity: row.quantity,
    currentLocation: row.current_location,
    operationalStatus: row.operational_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/** Zod's own shape for a field error, so the form can pin a message on a field. */
function fieldError(field: string, message: string): ValidationError {
  return new ValidationError(message, { formErrors: [], fieldErrors: { [field]: [message] } });
}

// -----------------------------------------------------------------------------
// AC1: add an item, and list the catalogue
// -----------------------------------------------------------------------------

/**
 * AC1: "when I add an equipment item with a name, category, quantity and
 * current location, then it is saved and listed in the catalogue."
 *
 * Refused, with nothing saved, when any of the four is missing or not valid;
 * the refusal names every failing field in one pass (TC-240-02), and AC4's
 * quantity rule is one of them (TC-240-10, TC-240-11).
 *
 * The new item's operational status is not an input: it starts Available
 * (DEFAULT_OPERATIONAL_STATUS, the column default). AC2's four statuses are
 * set afterwards with updateEquipmentItem.
 */
export async function createEquipmentItem(input: unknown, actorId: string): Promise<EquipmentItem> {
  const parsed = CreateEquipmentInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? 'The equipment item is not valid.',
      parsed.error.flatten(),
    );
  }

  const { data, error } = await insertEquipment({ ...parsed.data, createdBy: actorId });
  if (error || !data) {
    // The column checks mirror the schema, so a check violation here means a
    // value got past it; name the quantity field rather than failing with a
    // message no field owns.
    if (isCheckViolation(error)) throw fieldError('quantity', 'Quantity must be a whole number of at least zero.');
    throw new ValidationError('The equipment item could not be saved.', error?.message);
  }
  return toEquipmentItem(data as EquipmentRow);
}

/** AC1, AC2: the catalogue with every item's four fields and its status, in name order. */
export async function listEquipment(): Promise<EquipmentItem[]> {
  const { data, error } = await fetchEquipment();
  if (error || !data) throw new ValidationError('Could not load the equipment catalogue.', error?.message);
  return (data as EquipmentRow[]).map(toEquipmentItem);
}

/** One item, read from its stored row (AC2's "shown in the catalogue" after a reload). */
export async function getEquipmentItem(equipmentId: string): Promise<EquipmentItem> {
  const id = EquipmentIdSchema.safeParse(equipmentId);
  if (!id.success) throw new NotFoundError('Equipment item');

  const { data, error } = await fetchEquipmentById(id.data);
  if (error) throw new ValidationError('The equipment item could not be read.', error.message);
  if (!data) throw new NotFoundError('Equipment item');
  return toEquipmentItem(data as EquipmentRow);
}

// -----------------------------------------------------------------------------
// AC2, AC4: change an item
// -----------------------------------------------------------------------------

/**
 * AC2: "when I set its operational status to Available, Unavailable, Damaged
 * or Under maintenance, then the new status is saved and shown in the
 * catalogue." AC4's quantity rule holds here too (TC-240-12).
 *
 * A field left out is left unchanged, so setting a status does not blank the
 * name, quantity or location (TC-240-06). A status outside the four is refused
 * with the field named and the stored row untouched (TC-240-05).
 */
export async function updateEquipmentItem(equipmentId: string, input: unknown): Promise<EquipmentItem> {
  const id = EquipmentIdSchema.safeParse(equipmentId);
  if (!id.success) throw new NotFoundError('Equipment item');

  const parsed = UpdateEquipmentInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? 'The change is not valid.',
      parsed.error.flatten(),
    );
  }

  const { name, category, quantity, currentLocation, operationalStatus } = parsed.data;
  const { data, error } = await updateEquipmentRow(id.data, {
    ...(name !== undefined ? { name } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(quantity !== undefined ? { quantity } : {}),
    ...(currentLocation !== undefined ? { current_location: currentLocation } : {}),
    ...(operationalStatus !== undefined ? { operational_status: operationalStatus } : {}),
  });
  if (error) {
    if (isCheckViolation(error)) throw fieldError('quantity', 'Quantity must be a whole number of at least zero.');
    throw new ValidationError('The change could not be saved.', error.message);
  }
  if (!data) throw new NotFoundError('Equipment item');
  return toEquipmentItem(data as EquipmentRow);
}

// -----------------------------------------------------------------------------
// AC5: the list a coordinator's equipment requirement is chosen from
// -----------------------------------------------------------------------------

/**
 * AC5: the items a coordinator may choose when recording an equipment
 * requirement (SCRUM-160) - every item the catalogue holds, whatever its
 * operational status, because AC5 limits the choice to items that exist and
 * not to items free on the date (TC-240-16).
 *
 * This is the catalogue's half of AC5. The requirement itself is SCRUM-160's
 * story: it fills its picker from here and calls assertEquipmentInCatalogue
 * before saving.
 */
export async function listEquipmentOptions(): Promise<EquipmentOption[]> {
  const items = await listEquipment();
  return items.map((item) => EquipmentOptionSchema.parse(item));
}

/**
 * AC5: refuses a requirement that names equipment the catalogue does not hold,
 * so an id posted straight at the API is refused as well as one that was never
 * offered in the list (TC-240-15).
 *
 * An id that is not a valid uuid is refused for the same reason and with the
 * same message: it cannot be in the catalogue either.
 */
export async function assertEquipmentInCatalogue(equipmentIds: readonly string[]): Promise<void> {
  if (equipmentIds.length === 0) return;

  const wellFormed = equipmentIds.filter((id) => EquipmentIdSchema.safeParse(id).success);
  const { data, error } = await fetchEquipmentIdsIn(wellFormed);
  if (error || !data) throw new ValidationError('Could not read the equipment catalogue.', error?.message);

  assertEquipmentIdsKnown(
    data.map((row) => row.id),
    equipmentIds,
  );
}

/** What the add and edit forms need to fill their dropdowns (AC1's category, AC2's statuses). */
export function getEquipmentFormOptions(): EquipmentFormOptions {
  return EquipmentFormOptionsSchema.parse({
    categories: [...EQUIPMENT_CATEGORIES],
    operationalStatuses: [...OPERATIONAL_STATUSES],
  });
}
