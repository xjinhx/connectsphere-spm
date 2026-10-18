import { z } from 'zod';
import { assertEquipmentInCatalogue } from '@/domain/equipment/service';
import { isCurrentCoordinator } from '@/domain/assignment/policy';
import type { Role } from '@/domain/identity/roles';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, isCheckViolation } from '@/domain/shared/errors';
import { fetchEventRequestById, type EventRequestRow } from '@/lib/supabase/eventRequests';
import {
  deleteEquipmentRequestLine,
  ensureEquipmentRequest,
  fetchEquipmentRequest,
  fetchEquipmentRequestLine,
  fetchEquipmentRequestLines,
  fetchEquipmentRequestsByStatus,
  fetchReservedLineIds,
  insertEquipmentRequestLine,
  updateEquipmentRequestLineQuantity,
  upsertTechnicalRequirements,
} from '@/lib/supabase/equipmentRequests';
import {
  EVENT_NOT_OPEN_FOR_EQUIPMENT_MESSAGE,
  OUTSTANDING_EQUIPMENT_REQUEST_STATUSES,
  RESERVATION_WARNING_MESSAGE,
  acceptsEquipmentRequest,
  canViewEquipmentRequest,
  countUnavailableItems,
  linesOfSameType,
  needsReservationConfirmation,
  sortEquipmentQueue,
  type EquipmentQueueSort,
} from './policy';
import {
  AddEquipmentLineInputSchema,
  AddEquipmentLineOutcomeSchema,
  EquipmentQueueEntrySchema,
  EquipmentRequestLineIdSchema,
  QUANTITY_AT_LEAST_ONE_MESSAGE,
  SaveTechnicalRequirementsInputSchema,
  EquipmentRequestLineSchema,
  EquipmentRequestViewSchema,
  UpdateEquipmentLineInputSchema,
  type AddEquipmentLineOutcome,
  type EquipmentQueueEntry,
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

function toLine(row: LineRow, reserved: boolean): EquipmentRequestLine {
  return EquipmentRequestLineSchema.parse({
    id: row.id,
    equipmentId: row.equipment_id,
    // The foreign key is restrict, so a line always has its catalogue item.
    equipmentName: row.equipment?.name ?? '',
    category: row.equipment?.category,
    quantity: row.quantity,
    reserved,
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
 * - and every save of the technical requirements (AC5) comes through here
 * before anything is written.
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

/** AC5: the request's technical requirements, or null when nothing has been saved yet. */
async function readTechnicalRequirements(eventRequestId: string): Promise<string | null> {
  const { data, error } = await fetchEquipmentRequest(eventRequestId);
  if (error) throw new ValidationError('The equipment request could not be read.', error.message);
  return (data as { technical_requirements: string | null } | null)?.technical_requirements ?? null;
}

/** AC7, AC8: the ids, out of `lineIds`, of the lines that have been reserved. */
async function readReservedLineIds(lineIds: readonly string[]): Promise<Set<string>> {
  if (lineIds.length === 0) return new Set();
  const { data, error } = await fetchReservedLineIds(lineIds);
  if (error || !data) throw new ValidationError('The equipment reservations could not be read.', error?.message);
  return new Set((data as { line_id: string }[]).map((row) => row.line_id));
}

/** Rows as lines, each marked reserved or not. */
async function toLines(rows: readonly LineRow[]): Promise<EquipmentRequestLine[]> {
  const reserved = await readReservedLineIds(rows.map((row) => row.id));
  return rows.map((row) => toLine(row, reserved.has(row.id)));
}

async function readLines(eventRequestId: string): Promise<EquipmentRequestLine[]> {
  const { data, error } = await fetchEquipmentRequestLines(eventRequestId);
  if (error || !data) throw new ValidationError('The equipment request could not be read.', error?.message);
  return toLines(data as unknown as LineRow[]);
}

/** One line of the event's request, with whether it has been reserved. */
async function readLine(eventRequestId: string, lineId: string): Promise<EquipmentRequestLine> {
  const { data, error } = await fetchEquipmentRequestLine(eventRequestId, lineId);
  if (error) throw new ValidationError('The equipment line could not be read.', error.message);
  if (!data) throw new NotFoundError('Equipment line');
  const [line] = await toLines([data as unknown as LineRow]);
  if (!line) throw new NotFoundError('Equipment line');
  return line;
}

/**
 * AC8: refuses a change that needs the reservation warning confirmed and has
 * not been. A ConflictError (409) the page recognises by
 * reservationConfirmationRequired, so it can show the warning and send the
 * change again with the confirmation.
 */
function assertReservationConfirmed(line: EquipmentRequestLine, newQuantity: number | null, confirmed: boolean): void {
  if (needsReservationConfirmation(line, newQuantity) && !confirmed) {
    throw new ConflictError(RESERVATION_WARNING_MESSAGE, { reservationConfirmationRequired: true, lineId: line.id });
  }
}

// -----------------------------------------------------------------------------
// Reading the request
// -----------------------------------------------------------------------------

/**
 * An event's equipment request: its lines in the order they were added, read
 * from the stored rows (TC-160-01: "still shows after the reload"), with its
 * technical requirements (AC5).
 *
 * AC6: Technical Support Staff open it to see the notes with the equipment
 * list (TC-160-16); a request with no notes still shows its list
 * (TC-160-17), and each request shows only its own notes (TC-160-18). The
 * event's assigned coordinator may open it too (canViewEquipmentRequest).
 *
 * canEdit is true only for the assigned coordinator while the event is
 * Approved or in Planning, the same rules every edit applies, so the page
 * never offers an edit the API would refuse. Technical Support Staff read it.
 */
export async function getEquipmentRequest(eventRequestId: string, actor: Actor): Promise<EquipmentRequestView> {
  const event = await readEvent(eventRequestId);
  if (!canViewEquipmentRequest(actor, event.coordinator_id)) {
    throw new ForbiddenError("Only Technical Support Staff and the event's assigned coordinator can view its equipment request.");
  }
  const isCoordinator = isCurrentCoordinator(event.coordinator_id, actor.userId);

  return EquipmentRequestViewSchema.parse({
    eventRequestId: event.id,
    eventName: event.name,
    eventReference: event.reference,
    eventStatus: event.status,
    proposedDate: event.proposed_date,
    lines: await readLines(event.id),
    technicalRequirements: await readTechnicalRequirements(event.id),
    canEdit: isCoordinator && acceptsEquipmentRequest(event.status),
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
 *
 * AC10: the event's own status reacts to the new line - an Approved event
 * becomes Planning - through SCRUM-101's database trigger, in the same
 * transaction as the insert (equipment_request_line_enter_planning). Nothing
 * to call from here.
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
  // A line added a moment ago has no reservation yet.
  const line = toLine(data as unknown as LineRow, false);
  const sameTypeLines = linesOfSameType(await readLines(event.id), line);
  return AddEquipmentLineOutcomeSchema.parse({ line, sameTypeLines });
}

// -----------------------------------------------------------------------------
// AC7, AC8: change or remove an item
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
 *
 * AC8: a reduction of a reserved item is refused with the reservation warning
 * (a 409 with reservationConfirmationRequired) unless confirmReservationChange
 * is sent, and then applied (TC-160-21 to TC-160-23).
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

  const line = await readLine(event.id, id);
  assertReservationConfirmed(line, parsed.data.quantity, parsed.data.confirmReservationChange === true);

  const { data, error } = await updateEquipmentRequestLineQuantity(event.id, id, parsed.data.quantity);
  if (error) {
    if (isCheckViolation(error)) throw quantityError();
    throw new ValidationError('The change could not be saved.', error.message);
  }
  if (!data) throw new NotFoundError('Equipment line');
  return toLine(data as unknown as LineRow, line.reserved);
}

/**
 * AC7: "Given an equipment item has not yet been reserved, when I ... remove
 * it, then the change is saved immediately" (TC-160-19).
 *
 * AC8 (interim, see needsReservationConfirmation): removing a reserved item
 * needs the same confirmation as reducing it.
 */
export async function removeEquipmentLine(
  eventRequestId: string,
  lineId: string,
  actorId: string,
  options: { confirmReservationChange?: boolean } = {},
): Promise<void> {
  const event = await readEventForEdit(eventRequestId, actorId);
  const id = parseLineId(lineId);

  const line = await readLine(event.id, id);
  assertReservationConfirmed(line, null, options.confirmReservationChange === true);

  const { data, error } = await deleteEquipmentRequestLine(event.id, id);
  if (error) throw new ValidationError('The item could not be removed.', error.message);
  if (!data) throw new NotFoundError('Equipment line');
}

// -----------------------------------------------------------------------------
// AC5: technical requirements
// -----------------------------------------------------------------------------

/**
 * AC5: "Given I am editing an equipment request, when I enter free-text
 * technical requirements and save, then the notes are stored with the
 * request." Stored exactly as typed (TC-160-14); only a save stores them, so
 * text typed and left unsaved leaves the stored notes as they were
 * (TC-160-15). Saving them leaves the equipment lines alone.
 *
 * The same rules as every other edit: the event's assigned coordinator (AC4),
 * while it is Approved or in Planning (AC1). Saving notes alone does not raise
 * the request for AC10 - only an item does.
 *
 * Returns the stored notes.
 */
export async function saveTechnicalRequirements(
  eventRequestId: string,
  actorId: string,
  input: unknown,
): Promise<{ technicalRequirements: string | null }> {
  const event = await readEventForEdit(eventRequestId, actorId);

  const parsed = SaveTechnicalRequirementsInputSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error, 'The technical requirements are not valid.');

  const { data, error } = await upsertTechnicalRequirements(event.id, parsed.data.technicalRequirements);
  if (error || !data) {
    throw new ValidationError('The technical requirements could not be saved.', error?.message);
  }
  return { technicalRequirements: (data as { technical_requirements: string | null }).technical_requirements };
}

// ---------------------------------------------------------------------------
// SCRUM-164 — Queue of equipment requests awaiting review
// ---------------------------------------------------------------------------

type QueueRow = {
  event_request_id: string;
  status: string;
  event_request: { name: string; reference: string; proposed_date: string | null } | null;
  equipment_request_line: {
    id: string;
    quantity: number;
    unavailable: boolean;
    created_at: string;
    equipment: { name: string } | null;
  }[];
};

/**
 * One queue entry, or null for a request with no lines. A request exists from
 * the first save of its technical requirements, but it is raised when its
 * first item is added (SCRUM-160 AC10), so one with no items is not yet
 * awaiting review.
 */
function toQueueEntry(row: QueueRow): EquipmentQueueEntry | null {
  const [firstLine] = row.equipment_request_line;
  if (!firstLine) return null;
  // NOT NULL foreign key: a request always has its event.
  if (!row.event_request) {
    throw new ValidationError('An equipment request is missing its event.', { eventRequestId: row.event_request_id });
  }
  return EquipmentQueueEntrySchema.parse({
    eventRequestId: row.event_request_id,
    eventName: row.event_request.name,
    eventReference: row.event_request.reference,
    eventDate: row.event_request.proposed_date,
    status: row.status,
    lines: row.equipment_request_line.map((line) => ({
      id: line.id,
      // The foreign key is restrict, so a line always has its catalogue item.
      equipmentName: line.equipment?.name ?? '',
      quantity: line.quantity,
    })),
    unavailableCount: countUnavailableItems(row.equipment_request_line),
    // Lines are read oldest first, so the first one is when it was raised.
    raisedAt: firstLine.created_at,
  });
}

/**
 * SCRUM-164 AC1 to AC5 - every outstanding equipment request, in the order
 * `sort` asks for (sortEquipmentQueue, policy.ts).
 *
 * AC1: each with its event, event date, items and quantities. AC3: fulfilled
 * and unable to fulfil are not read. AC4: partially fulfilled is, with its
 * unavailable count. AC5: nothing filters by location or equipment type.
 *
 * Who may see it (Technical Support Staff, equipment_administration) is
 * checked by the caller before this is called, the same split as SCRUM-147's
 * listPendingBookingQueue.
 */
export async function listEquipmentQueue(sort: EquipmentQueueSort = 'raised'): Promise<EquipmentQueueEntry[]> {
  const { data, error } = await fetchEquipmentRequestsByStatus(OUTSTANDING_EQUIPMENT_REQUEST_STATUSES);
  if (error || !data) {
    throw new ValidationError('Could not load the equipment request queue.', error?.message);
  }
  const entries = (data as unknown as QueueRow[]).flatMap((row) => toQueueEntry(row) ?? []);
  return sortEquipmentQueue(entries, sort);
}
