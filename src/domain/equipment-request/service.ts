import { z } from 'zod';
import { assertEquipmentInCatalogue } from '@/domain/equipment/service';
import { isCurrentCoordinator } from '@/domain/assignment/policy';
import type { Role } from '@/domain/identity/roles';
import { ForbiddenError, NotFoundError, ValidationError } from '@/domain/shared/errors';
import { fetchEventRequestById, type EventRequestRow } from '@/lib/supabase/eventRequests';
import {
  deleteEquipmentRequestLine,
  ensureEquipmentRequest,
  fetchEquipmentRequestLines,
  insertEquipmentRequestLine,
  updateEquipmentRequestLineQuantity,
} from '@/lib/supabase/equipmentRequests';
import { EVENT_NOT_OPEN_FOR_EQUIPMENT_MESSAGE, acceptsEquipmentRequest } from './policy';
import {
  AddEquipmentLineInputSchema,
  AddEquipmentLineOutcomeSchema,
  EquipmentRequestLineIdSchema,
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

async function readEvent(eventRequestId: string): Promise<EventRequestRow> {
  const id = z.string().uuid().safeParse(eventRequestId);
  if (!id.success) throw new NotFoundError('Event request');

  const { data, error } = await fetchEventRequestById(id.data);
  if (error) throw new ValidationError('The event request could not be read.', error.message);
  if (!data) throw new NotFoundError('Event request');
  return data as unknown as EventRequestRow;
}

/** The event, refused unless it is still open to equipment request edits (AC1's statuses). */
async function readOpenEvent(eventRequestId: string): Promise<EventRequestRow> {
  const event = await readEvent(eventRequestId);
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
 */
export async function addEquipmentLine(
  eventRequestId: string,
  actorId: string,
  input: unknown,
): Promise<AddEquipmentLineOutcome> {
  const event = await readOpenEvent(eventRequestId);

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
  if (error || !data) throw new ValidationError('The equipment item could not be saved.', error?.message);

  return AddEquipmentLineOutcomeSchema.parse({ line: toLine(data as unknown as LineRow) });
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
  input: unknown,
): Promise<EquipmentRequestLine> {
  const event = await readOpenEvent(eventRequestId);
  const id = parseLineId(lineId);

  const parsed = UpdateEquipmentLineInputSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error, 'The quantity is not valid.');

  const { data, error } = await updateEquipmentRequestLineQuantity(event.id, id, parsed.data.quantity);
  if (error) throw new ValidationError('The change could not be saved.', error.message);
  if (!data) throw new NotFoundError('Equipment line');
  return toLine(data as unknown as LineRow);
}

/**
 * AC7: "Given an equipment item has not yet been reserved, when I ... remove
 * it, then the change is saved immediately" (TC-160-19).
 */
export async function removeEquipmentLine(eventRequestId: string, lineId: string): Promise<void> {
  const event = await readOpenEvent(eventRequestId);
  const id = parseLineId(lineId);

  const { data, error } = await deleteEquipmentRequestLine(event.id, id);
  if (error) throw new ValidationError('The item could not be removed.', error.message);
  if (!data) throw new NotFoundError('Equipment line');
}
