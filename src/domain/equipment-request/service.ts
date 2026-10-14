import { z } from 'zod';
import { assertEquipmentInCatalogue } from '@/domain/equipment/service';
import { isCurrentCoordinator } from '@/domain/assignment/policy';
import type { Role } from '@/domain/identity/roles';
import { ForbiddenError, NotFoundError, ValidationError, isCheckViolation } from '@/domain/shared/errors';
import { fetchEventRequestById, type EventRequestRow } from '@/lib/supabase/eventRequests';
import {
  deleteEquipmentRequestLine,
  ensureEquipmentRequest,
  fetchEquipmentRequestLines,
  insertEquipmentRequestLine,
  updateEquipmentRequestLineQuantity,
} from '@/lib/supabase/equipmentRequests';
import { EVENT_NOT_OPEN_FOR_EQUIPMENT_MESSAGE, acceptsEquipmentRequest, linesOfSameType } from './policy';
import {
  AddEquipmentLineInputSchema,
  AddEquipmentLineOutcomeSchema,
  EquipmentRequestLineIdSchema,
  QUANTITY_AT_LEAST_ONE_MESSAGE,
  EquipmentRequestLineSchema,
  EquipmentRequestViewSchema,
  UpdateEquipmentLineInputSchema,
  type AddEquipmentLineOutcome,
  type EquipmentRequestLine,
  type EquipmentRequestView,
} from './schema';

/**
 * Equipment request service (SCRUM-160 Record the equipment an event needs).
 *
 * Orchestration only: queries live in src/lib/supabase/equipmentRequests.ts,
 * the rules in policy.ts, single-field rules in schema.ts. Rows are parsed
 * back through the output schemas, so what leaves this file matches the
 * contract the API and the UI expect.
 *
 * The acting account is the signed-in one, passed in by the route from
 * getCurrentActor - never an id from the request body.
 */

type Actor = { userId: string; roles: readonly Role[] };

type LineRow = {
  id: string;
  event_request_id: string;
  equipment_id: string;
  quantity: number;
  created_at: string;
  equipment: { name: string; category: string } | null;
};

function toLine(row: LineRow): EquipmentRequestLine {
  return EquipmentRequestLineSchema.parse({
    id: row.id,
    equipmentId: row.equipment_id,
    // The foreign key is restrict, so a line always has its catalogue item.
    equipmentName: row.equipment?.name ?? '',
    category: row.equipment?.category,
    quantity: row.quantity,
    createdAt: row.created_at,
  });
}

function validationError(error: z.ZodError, fallback: string): ValidationError {
  return new ValidationError(error.issues[0]?.message ?? fallback, error.flatten());
}

/**
 * AC2: the column check mirrors the schema, so a check violation means a value
 * got past it; name the quantity field rather than failing with a message no
 * field owns.
 */
function quantityError(): ValidationError {
  return new ValidationError(QUANTITY_AT_LEAST_ONE_MESSAGE, {
    formErrors: [],
    fieldErrors: { quantity: [QUANTITY_AT_LEAST_ONE_MESSAGE] },
  });
}

async function readEvent(eventRequestId: string): Promise<EventRequestRow> {
  const id = z.string().uuid().safeParse(eventRequestId);
  if (!id.success) throw new NotFoundError('Event request');

  const { data, error } = await fetchEventRequestById(id.data);
  if (error) throw new ValidationError('The event request could not be read.', error.message);
  if (!data) throw new NotFoundError('Event request');
  return data as unknown as EventRequestRow;
}

export const NOT_ASSIGNED_MESSAGE = 'This event is not assigned to you.';

/**
 * The event, refused unless `actorId` may edit its equipment request now.
 *
 * AC4: "Given I am an Event Coordinator who is not assigned to the event, when
 * I invoke an equipment-request edit on it, then it is refused and the request
 * is unchanged." Checked against the event's current coordinator, so one
 * reassigned away is refused too (TC-160-12). Every edit - add, change, remove
 * - comes through here before anything is written.
 *
 * Refused before AC1's status check, the same order as SCRUM-142's
 * submitVenueBookingRequest: a coordinator the event is not assigned to learns
 * nothing about it, not even its status.
 */
async function readEventForEdit(eventRequestId: string, actorId: string): Promise<EventRequestRow> {
  const event = await readEvent(eventRequestId);
  if (!isCurrentCoordinator(event.coordinator_id, actorId)) {
    throw new ForbiddenError(NOT_ASSIGNED_MESSAGE);
  }
  if (!acceptsEquipmentRequest(event.status)) {
    throw new ValidationError(EVENT_NOT_OPEN_FOR_EQUIPMENT_MESSAGE);
  }
  return event;
}

async function readLines(eventRequestId: string): Promise<EquipmentRequestLine[]> {
  const { data, error } = await fetchEquipmentRequestLines(eventRequestId);
  if (error || !data) throw new ValidationError('The equipment request could not be read.', error?.message);
  return (data as unknown as LineRow[]).map(toLine);
}

// -----------------------------------------------------------------------------
// Reading the request
// -----------------------------------------------------------------------------

/**
 * An event's equipment request: its lines in the order they were added, read
 * from the stored rows (TC-160-01: "still shows after the reload").
 *
 * Open to the event's assigned coordinator.
 */
export async function getEquipmentRequest(eventRequestId: string, actor: Actor): Promise<EquipmentRequestView> {
  const event = await readEvent(eventRequestId);
  const isCoordinator = isCurrentCoordinator(event.coordinator_id, actor.userId);
  if (!isCoordinator) {
    throw new ForbiddenError("Only the event's assigned coordinator can view its equipment request.");
  }

  return EquipmentRequestViewSchema.parse({
    eventRequestId: event.id,
    eventName: event.name,
    eventReference: event.reference,
    eventStatus: event.status,
    proposedDate: event.proposed_date,
    lines: await readLines(event.id),
    canEdit: acceptsEquipmentRequest(event.status),
  });
}

// -----------------------------------------------------------------------------
// AC1: add an item
// -----------------------------------------------------------------------------

/**
 * AC1: "Given I am the assigned coordinator of an event that is Approved or in
 * Planning, when I add an equipment type and a quantity, then the item is
 * saved against the event's equipment request."
 *
 * Refused, with nothing saved, when the event is in any other status
 * (TC-160-02) or the type or quantity is missing or not valid (TC-160-03).
 * The type must be an item the catalogue holds (SCRUM-240 AC5,
 * assertEquipmentInCatalogue), so an id posted straight at the API is refused
 * as well as one the picker never offered.
 *
 * The event's first line creates its equipment request.
 *
 * AC3: adding a type the event already has creates a separate line, and the
 * outcome lists the existing ones (TC-160-07, TC-160-08).
 */
export async function addEquipmentLine(
  eventRequestId: string,
  actorId: string,
  input: unknown,
): Promise<AddEquipmentLineOutcome> {
  const event = await readEventForEdit(eventRequestId, actorId);

  const parsed = AddEquipmentLineInputSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error, 'The equipment item is not valid.');

  await assertEquipmentInCatalogue([parsed.data.equipmentId]);

  const { error: requestError } = await ensureEquipmentRequest(event.id);
  if (requestError) throw new ValidationError('The equipment request could not be saved.', requestError.message);

  const { data, error } = await insertEquipmentRequestLine({
    eventRequestId: event.id,
    equipmentId: parsed.data.equipmentId,
    quantity: parsed.data.quantity,
    createdBy: actorId,
  });
  if (error || !data) {
    if (isCheckViolation(error)) throw quantityError();
    throw new ValidationError('The equipment item could not be saved.', error?.message);
  }

  // AC3: always a new line, never folded into an existing one; the existing
  // lines of the same type come back so the coordinator is shown them.
  const line = toLine(data as unknown as LineRow);
  const sameTypeLines = linesOfSameType(await readLines(event.id), line);
  return AddEquipmentLineOutcomeSchema.parse({ line, sameTypeLines });
}

// -----------------------------------------------------------------------------
// AC7: change or remove an item
// -----------------------------------------------------------------------------

function parseLineId(lineId: string): string {
  const id = EquipmentRequestLineIdSchema.safeParse(lineId);
  if (!id.success) throw new NotFoundError('Equipment line');
  return id.data;
}

/**
 * AC7: "Given an equipment item has not yet been reserved, when I change its
 * quantity ... then the change is saved immediately" - one call, no
 * confirmation step (TC-160-19, TC-160-20). Only the quantity changes; the
 * item a line names is fixed once added.
 */
export async function updateEquipmentLineQuantity(
  eventRequestId: string,
  lineId: string,
  actorId: string,
  input: unknown,
): Promise<EquipmentRequestLine> {
  const event = await readEventForEdit(eventRequestId, actorId);
  const id = parseLineId(lineId);

  const parsed = UpdateEquipmentLineInputSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error, 'The quantity is not valid.');

  const { data, error } = await updateEquipmentRequestLineQuantity(event.id, id, parsed.data.quantity);
  if (error) {
    if (isCheckViolation(error)) throw quantityError();
    throw new ValidationError('The change could not be saved.', error.message);
  }
  if (!data) throw new NotFoundError('Equipment line');
  return toLine(data as unknown as LineRow);
}

/**
 * AC7: "Given an equipment item has not yet been reserved, when I ... remove
 * it, then the change is saved immediately" (TC-160-19).
 */
export async function removeEquipmentLine(eventRequestId: string, lineId: string, actorId: string): Promise<void> {
  const event = await readEventForEdit(eventRequestId, actorId);
  const id = parseLineId(lineId);

  const { data, error } = await deleteEquipmentRequestLine(event.id, id);
  if (error) throw new ValidationError('The item could not be removed.', error.message);
  if (!data) throw new NotFoundError('Equipment line');
}
