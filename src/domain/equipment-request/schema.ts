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

/**
 * AC7: "when I change its quantity".
 *
 * AC8: confirmReservationChange is the coordinator's confirmation after the
 * reservation warning. Left out, a reduction of a reserved item is not applied.
 */
export const UpdateEquipmentLineInputSchema = z.object({
  quantity: RequestedQuantitySchema,
  confirmReservationChange: z.boolean().optional(),
});
export type UpdateEquipmentLineInput = z.infer<typeof UpdateEquipmentLineInputSchema>;

/**
 * AC5: "when I enter free-text technical requirements and save, then the notes
 * are stored with the request." Stored exactly as typed - line breaks, quotes
 * and <, > and & included (TC-160-14) - so the text is not trimmed. Text that
 * is only spaces is stored as none.
 *
 * 1000 characters, the same limit as SCRUM-80's technical support notes.
 */
export const TECHNICAL_REQUIREMENTS_MAX_LENGTH = 1000;
export const SaveTechnicalRequirementsInputSchema = z.object({
  technicalRequirements: z
    .string({
      required_error: 'Technical requirements are required.',
      invalid_type_error: 'Technical requirements must be text.',
    })
    .max(
      TECHNICAL_REQUIREMENTS_MAX_LENGTH,
      `Technical requirements must be ${TECHNICAL_REQUIREMENTS_MAX_LENGTH} characters or fewer.`,
    )
    .transform((text) => (text.trim() === '' ? null : text)),
});
export type SaveTechnicalRequirementsInput = z.infer<typeof SaveTechnicalRequirementsInputSchema>;

/** One line of the request, as the API and the page show it. */
export const EquipmentRequestLineSchema = z.object({
  id: z.string().uuid(),
  equipmentId: z.string().uuid(),
  equipmentName: z.string(),
  category: EquipmentCategorySchema,
  quantity: z.number().int(),
  /** AC7, AC8: whether the item has been reserved; reducing a reserved item needs a confirmation. */
  reserved: z.boolean(),
  /** SCRUM-166 AC3: marked unavailable by Technical Support Staff (only while partially fulfilled). */
  unavailable: z.boolean(),
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
  /** AC5: the free-text technical requirements, or null when none have been entered. */
  technicalRequirements: z.string().nullable(),
  /** Whether the signed-in account may change it: the assigned coordinator, while the event is open to it. */
  canEdit: z.boolean(),
  /**
   * SCRUM-166: the request's status, who set it and when, and the reason when
   * it cannot be fulfilled. Null while the event has no request yet (no line
   * added). Shown to Technical Support Staff and the assigned coordinator
   * (AC2).
   */
  requestStatus: z
    .object({
      // Lazy: the four statuses are defined in the SCRUM-164 section below.
      status: z.lazy(() => EquipmentRequestStatusSchema),
      /** AC2: the name of whoever set it; null while it is still the status it was raised with (AC1). */
      setByName: z.string().nullable(),
      /** AC2: when it was set (ISO timestamp); null as for setByName. */
      setAt: z.string().nullable(),
      /** AC4: why it cannot be fulfilled; null for every other status. */
      unableReason: z.string().nullable(),
    })
    .nullable(),
  /** SCRUM-166 AC2: whether the signed-in account may set the status - Technical Support Staff. */
  canSetStatus: z.boolean(),
});
export type EquipmentRequestView = z.infer<typeof EquipmentRequestViewSchema>;

/**
 * What adding a line returns: the saved line and, for AC3, the event's other
 * lines of the same type, so the coordinator is shown them and can merge by
 * hand (change one quantity, remove the other).
 */
export const AddEquipmentLineOutcomeSchema = z.object({
  line: EquipmentRequestLineSchema,
  sameTypeLines: z.array(EquipmentRequestLineSchema),
});
export type AddEquipmentLineOutcome = z.infer<typeof AddEquipmentLineOutcomeSchema>;

// ---------------------------------------------------------------------------
// SCRUM-164 — Queue of equipment requests awaiting review
// ---------------------------------------------------------------------------

/**
 * An equipment request's status, as SCRUM-166 (Update the status of an
 * equipment request) names them: under review when raised (its AC1), then
 * partially fulfilled, fulfilled or unable to fulfil (its AC2). Technical
 * Support Staff set them through updateEquipmentRequestStatus (SCRUM-166,
 * D-19 replaced).
 */
export const EQUIPMENT_REQUEST_STATUSES = ['under_review', 'partially_fulfilled', 'fulfilled', 'unable_to_fulfil'] as const;
export const CHOOSE_STATUS_MESSAGE = 'Choose a status.';
export const EquipmentRequestStatusSchema = z.enum(EQUIPMENT_REQUEST_STATUSES, {
  errorMap: () => ({ message: CHOOSE_STATUS_MESSAGE }),
});
export type EquipmentRequestStatus = z.infer<typeof EquipmentRequestStatusSchema>;

export const EQUIPMENT_REQUEST_STATUS_LABELS: Record<EquipmentRequestStatus, string> = {
  under_review: 'Under review',
  partially_fulfilled: 'Partially fulfilled',
  fulfilled: 'Fulfilled',
  unable_to_fulfil: 'Unable to fulfil',
};

/** AC1: one requested item and its quantity, as the queue shows it. */
export const EquipmentQueueLineSchema = z.object({
  id: z.string().uuid(),
  equipmentName: z.string(),
  quantity: z.number().int(),
});
export type EquipmentQueueLine = z.infer<typeof EquipmentQueueLineSchema>;

/**
 * One outstanding equipment request in the queue.
 *
 * AC1: its event, the event's date and the requested items with their
 * quantities. AC4: how many items are still unavailable.
 */
export const EquipmentQueueEntrySchema = z.object({
  eventRequestId: z.string().uuid(),
  eventName: z.string(),
  eventReference: z.string(),
  /** The event's date (YYYY-MM-DD), or null when the event has none yet. */
  eventDate: z.string().nullable(),
  status: EquipmentRequestStatusSchema,
  lines: z.array(EquipmentQueueLineSchema),
  /** AC4: lines marked unavailable, each counted once whatever its quantity. */
  unavailableCount: z.number().int().min(0),
  /** When the request was raised: its first line was added (SCRUM-160 AC10). */
  raisedAt: z.string(),
});
export type EquipmentQueueEntry = z.infer<typeof EquipmentQueueEntrySchema>;

// ---------------------------------------------------------------------------
// SCRUM-166 — Update the status of an equipment request
// ---------------------------------------------------------------------------

/** AC4: the reason is stored with the request; the same limit as the technical requirements. */
export const UNABLE_REASON_MAX_LENGTH = 1000;

/**
 * AC2: "when I set its status to partially fulfilled, fulfilled or unable to
 * fulfil". Under review can be set again too: any status can be set again,
 * and only the latest is kept (TC-166-06).
 *
 * unavailableLineIds: AC3, the lines Technical Support Staff mark unavailable.
 * Only kept for partially fulfilled. reason: AC4, only kept for unable to
 * fulfil. Text that is only spaces counts as no reason (TC-166-15). Whether
 * each is present when its status needs it is policy.ts
 * (statusUpdateProblem), so both are optional here.
 */
export const UpdateEquipmentRequestStatusInputSchema = z.object({
  status: EquipmentRequestStatusSchema,
  unavailableLineIds: z
    .array(EquipmentRequestLineIdSchema, { invalid_type_error: 'Unavailable items must be a list of lines.' })
    .max(200, 'Too many unavailable items.')
    .default([]),
  reason: z
    .string({ invalid_type_error: 'The reason must be text.' })
    .max(UNABLE_REASON_MAX_LENGTH, `The reason must be ${UNABLE_REASON_MAX_LENGTH} characters or fewer.`)
    .nullish()
    .transform((text) => (text == null || text.trim() === '' ? null : text.trim())),
});
export type UpdateEquipmentRequestStatusInput = z.infer<typeof UpdateEquipmentRequestStatusInputSchema>;
