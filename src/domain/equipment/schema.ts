import { z } from 'zod';

/**
 * Equipment catalogue (EP-43): data shapes shared by the API routes and the UI.
 *
 * SCRUM-240 Maintain the equipment catalogue
 *
 * The catalogue is the record of the equipment ConnectSphere owns, with its
 * quantity, its physical location and its operational status. It is the list a
 * coordinator's equipment requirement is chosen from (AC5, SCRUM-160); it says
 * nothing about what is free on a given date, which is equipment availability
 * and reservation (SCRUM-166/167/170, not in this sprint).
 *
 * Values mirror the check constraints in
 * supabase/migrations/20261013093825_create_equipment_catalogue.sql.
 *
 * Single-field rules live here, so one Zod parse can name every field AC1 and
 * AC4 ask to have identified. Who may do what is policy.ts.
 */

// -----------------------------------------------------------------------------
// Fixed value lists
// -----------------------------------------------------------------------------

/**
 * AC1's category. A PROPOSAL under customer clarification #13 ("the modelling
 * is ours to propose"), not a list the customer gave: a short fixed list so the
 * form can offer it and the catalogue can be grouped by it. Extend it here and
 * in equipment_category_known in the migration, together.
 */
export const EQUIPMENT_CATEGORIES = ['av', 'furniture', 'computing', 'other'] as const;
export const EquipmentCategorySchema = z.enum(EQUIPMENT_CATEGORIES, {
  required_error: 'Choose a category.',
  invalid_type_error: 'Choose a category.',
});
export type EquipmentCategory = z.infer<typeof EquipmentCategorySchema>;

export const EQUIPMENT_CATEGORY_LABELS: Record<EquipmentCategory, string> = {
  av: 'AV',
  furniture: 'Furniture',
  computing: 'Computing',
  other: 'Other',
};

/**
 * AC2 and customer clarification #23: the four operational statuses, stored
 * lowercase like every other fixed list (profile roles, operating slots).
 */
export const OPERATIONAL_STATUSES = ['available', 'unavailable', 'damaged', 'under_maintenance'] as const;
export const OperationalStatusSchema = z.enum(OPERATIONAL_STATUSES, {
  required_error: 'Choose an operational status.',
  invalid_type_error: 'Choose one of the four operational statuses.',
});
export type OperationalStatus = z.infer<typeof OperationalStatusSchema>;

export const OPERATIONAL_STATUS_LABELS: Record<OperationalStatus, string> = {
  available: 'Available',
  unavailable: 'Unavailable',
  damaged: 'Damaged',
  under_maintenance: 'Under maintenance',
};

/**
 * The status a new item starts at. AC1 lists name, category, quantity and
 * location and no status field, so the add form does not offer one.
 *
 * INTERIM, to confirm at standup (recorded on the ticket and in TC-240-03):
 * an item nobody has inspected is listed as Available.
 */
export const DEFAULT_OPERATIONAL_STATUS: OperationalStatus = 'available';

export const EQUIPMENT_NAME_MAX_LENGTH = 100;
export const EQUIPMENT_LOCATION_MAX_LENGTH = 100;

/**
 * The largest value the integer quantity column can hold. Same reason as
 * venues' CAPACITY_COLUMN_MAX: without it, a bigger number passes Zod and then
 * fails in Postgres with an error the form cannot pin on a field. Not a
 * business limit - none has been agreed.
 */
export const QUANTITY_COLUMN_MAX = 2_147_483_647;

// -----------------------------------------------------------------------------
// Building blocks
// -----------------------------------------------------------------------------

export const EquipmentIdSchema = z.string().uuid('Equipment id must be a valid id.');

const EquipmentNameSchema = z
  .string({ required_error: 'Equipment name is required.', invalid_type_error: 'Equipment name is required.' })
  .trim()
  .min(1, 'Equipment name is required.')
  .max(EQUIPMENT_NAME_MAX_LENGTH, `Equipment name must be ${EQUIPMENT_NAME_MAX_LENGTH} characters or fewer.`);

/** Customer clarification #2: equipment has a physical location, e.g. a store room. */
const CurrentLocationSchema = z
  .string({ required_error: 'Current location is required.', invalid_type_error: 'Current location is required.' })
  .trim()
  .min(1, 'Current location is required.')
  .max(EQUIPMENT_LOCATION_MAX_LENGTH, `Current location must be ${EQUIPMENT_LOCATION_MAX_LENGTH} characters or fewer.`);

/**
 * AC4: "a quantity below zero or a non-integer ... is refused and the quantity
 * field is identified". Zero is not below zero, so 0 is accepted (TC-240-10):
 * an item the catalogue records but holds none of.
 *
 * The form sends a whole number as a number and anything else as the text that
 * was typed (quantityInput.ts), so "ten", "2.5" and an empty box all land here
 * as something z.number() refuses - each with the message on this field.
 */
const QuantitySchema = z
  .number({
    required_error: 'Quantity is required.',
    invalid_type_error: 'Quantity must be a whole number.',
  })
  .int('Quantity must be a whole number.')
  .min(0, 'Quantity cannot be below zero.')
  .max(QUANTITY_COLUMN_MAX, 'Quantity is too large.');

// -----------------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------------

/**
 * AC1: "when I add an equipment item with a name, category, quantity and
 * current location, then it is saved and listed in the catalogue."
 *
 * All four are required, and safeParse collects every failing field in one
 * pass, so a save with three empty boxes identifies all three (TC-240-02)
 * rather than only the first.
 */
export const CreateEquipmentInputSchema = z.object({
  name: EquipmentNameSchema,
  category: EquipmentCategorySchema,
  quantity: QuantitySchema,
  currentLocation: CurrentLocationSchema,
});
export type CreateEquipmentInput = z.infer<typeof CreateEquipmentInputSchema>;

/**
 * AC2 and AC4 on an existing item. PATCH, as everywhere else in this codebase:
 * a field left out is left unchanged, so setting a status does not blank the
 * name, quantity or location (TC-240-06), and AC4's rule holds on an edit as
 * well as on an add (TC-240-12).
 *
 * Sending nothing at all is refused rather than treated as a no-op save, so a
 * form that fails to send its field is not mistaken for a successful change.
 */
export const UpdateEquipmentInputSchema = z
  .object({
    name: EquipmentNameSchema.optional(),
    category: EquipmentCategorySchema.optional(),
    quantity: QuantitySchema.optional(),
    currentLocation: CurrentLocationSchema.optional(),
    operationalStatus: OperationalStatusSchema.optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), 'Change at least one field.');
export type UpdateEquipmentInput = z.infer<typeof UpdateEquipmentInputSchema>;

// -----------------------------------------------------------------------------
// Output
// -----------------------------------------------------------------------------

/** One catalogue item, as the API and the catalogue page show it (AC1, AC2). */
export const EquipmentItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  category: EquipmentCategorySchema,
  quantity: z.number().int(),
  currentLocation: z.string(),
  operationalStatus: OperationalStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EquipmentItem = z.infer<typeof EquipmentItemSchema>;

/**
 * AC5: one item as the coordinator's equipment requirement picker (SCRUM-160)
 * offers it. Its status comes along so the picker can show it, but it does not
 * decide what is offered - AC5 limits the choice to items that exist, not to
 * items free on the date (TC-240-16).
 */
export const EquipmentOptionSchema = EquipmentItemSchema.pick({
  id: true,
  name: true,
  category: true,
  quantity: true,
  operationalStatus: true,
});
export type EquipmentOption = z.infer<typeof EquipmentOptionSchema>;

/** What the add and edit forms need to fill their dropdowns. */
export const EquipmentFormOptionsSchema = z.object({
  categories: z.array(EquipmentCategorySchema),
  operationalStatuses: z.array(OperationalStatusSchema),
});
export type EquipmentFormOptions = z.infer<typeof EquipmentFormOptionsSchema>;
