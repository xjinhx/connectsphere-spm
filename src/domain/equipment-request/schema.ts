import { z } from 'zod';
import { EventRequestStatusEnum } from '@/domain/event-request/schema';
import { EquipmentCategorySchema, QUANTITY_COLUMN_MAX } from '@/domain/equipment/schema';

/**
 * Equipment request (SCRUM-160 Record the equipment an event needs): data
 * shapes shared by the API routes and the UI.
 *
 * An event's equipment request is the list of catalogue items, each with a
 * quantity, that its assigned coordinator asks Technical Support Staff to
 * arrange. Items are chosen from the equipment catalogue (SCRUM-240 AC5).
 *
 * Single-field rules live here; who may do what, and when, is policy.ts.
 */

export const EquipmentRequestLineIdSchema = z.string().uuid('Equipment line id must be a valid id.');

/** AC1: "when I add an equipment type". The type is a catalogue item, chosen by its id. */
export const CHOOSE_EQUIPMENT_TYPE_MESSAGE = 'Choose an equipment type.';
const EquipmentTypeSchema = z
  .string({ required_error: CHOOSE_EQUIPMENT_TYPE_MESSAGE, invalid_type_error: CHOOSE_EQUIPMENT_TYPE_MESSAGE })
  .uuid(CHOOSE_EQUIPMENT_TYPE_MESSAGE);

/**
 * AC2: "Given I enter a quantity that is zero or negative, when I attempt to
 * save, then the item is not added and I am told the quantity must be at least
 * one." 0 is the highest refused value (TC-160-04) and 1 the lowest accepted
 * (TC-160-05). The same rule holds when a line's quantity is changed
 * (TC-160-06): removing a line is the way to take it to nothing.
 */
export const QUANTITY_AT_LEAST_ONE_MESSAGE = 'Quantity must be at least one.';

/** AC1: "and a quantity". A whole number of at least one (AC2). */
export const RequestedQuantitySchema = z
  .number({
    required_error: 'Quantity is required.',
    invalid_type_error: 'Quantity must be a whole number.',
  })
  .int('Quantity must be a whole number.')
  .min(1, QUANTITY_AT_LEAST_ONE_MESSAGE)
  .max(QUANTITY_COLUMN_MAX, 'Quantity is too large.');

/**
 * AC1: "when I add an equipment type and a quantity, then the item is saved
 * against the event's equipment request." Both are required, and one parse
 * names every failing field (TC-160-03).
 */
export const AddEquipmentLineInputSchema = z.object({
  equipmentId: EquipmentTypeSchema,
  quantity: RequestedQuantitySchema,
});
export type AddEquipmentLineInput = z.infer<typeof AddEquipmentLineInputSchema>;

/** AC7: "when I change its quantity". */
export const UpdateEquipmentLineInputSchema = z.object({
  quantity: RequestedQuantitySchema,
});
export type UpdateEquipmentLineInput = z.infer<typeof UpdateEquipmentLineInputSchema>;

/** One line of the request, as the API and the page show it. */
export const EquipmentRequestLineSchema = z.object({
  id: z.string().uuid(),
  equipmentId: z.string().uuid(),
  equipmentName: z.string(),
  category: EquipmentCategorySchema,
  quantity: z.number().int(),
  createdAt: z.string(),
});
export type EquipmentRequestLine = z.infer<typeof EquipmentRequestLineSchema>;

/** An event's equipment request: the event it belongs to and its lines. */
export const EquipmentRequestViewSchema = z.object({
  eventRequestId: z.string().uuid(),
  eventName: z.string(),
  eventReference: z.string(),
  eventStatus: EventRequestStatusEnum,
  proposedDate: z.string().nullable(),
  lines: z.array(EquipmentRequestLineSchema),
  /** Whether the signed-in account may change it: the assigned coordinator, while the event is open to it. */
  canEdit: z.boolean(),
});
export type EquipmentRequestView = z.infer<typeof EquipmentRequestViewSchema>;

/** What adding a line returns: the saved line. */
export const AddEquipmentLineOutcomeSchema = z.object({
  line: EquipmentRequestLineSchema,
});
export type AddEquipmentLineOutcome = z.infer<typeof AddEquipmentLineOutcomeSchema>;
