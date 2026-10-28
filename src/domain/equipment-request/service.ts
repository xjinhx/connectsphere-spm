import { z } from 'zod';
import { assertEquipmentInCatalogue } from '@/domain/equipment/service';
import { isCurrentCoordinator } from '@/domain/assignment/policy';
import { isActionPermitted } from '@/domain/identity/permissions';
import { assertPermission } from '@/domain/identity/policy';
import type { Role } from '@/domain/identity/roles';
import { notifyBestEffort } from '@/domain/notification/service';
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
  saveSuitabilityVerdicts,
  setEquipmentRequestStatus,
  setReviewCompleted,
  updateEquipmentRequestLineQuantity,
  upsertTechnicalRequirements,
} from '@/lib/supabase/equipmentRequests';
import { fetchProfileNames } from '@/lib/supabase/profiles';
import { checkEquipmentAvailability } from '@/domain/equipment-reservation/service';
import {
  EVENT_NOT_OPEN_FOR_EQUIPMENT_MESSAGE,
  OUTSTANDING_EQUIPMENT_REQUEST_STATUSES,
  RESERVATION_WARNING_MESSAGE,
  acceptsEquipmentRequest,
  canViewEquipmentRequest,
  countUnavailableItems,
  linesOfSameType,
  needsReservationConfirmation,
  notReadyReasons,
  notifiesCoordinator,
  sortEquipmentQueue,
  statusUpdateProblem,
  statusUpdateToStore,
  suitabilityProblem,
  suitabilityToStore,
  unableToFulfilMessage,
  UNKNOWN_LINE_MESSAGE,
  UNKNOWN_SUITABILITY_LINE_MESSAGE,
  type EquipmentQueueSort,
} from './policy';
import {
  AddEquipmentLineInputSchema,
  AddEquipmentLineOutcomeSchema,
  CompleteReviewOutcomeSchema,
  SaveSuitabilityInputSchema,
  EquipmentQueueEntrySchema,
  EquipmentRequestLineIdSchema,
  QUANTITY_AT_LEAST_ONE_MESSAGE,
  SaveTechnicalRequirementsInputSchema,
  EquipmentRequestLineSchema,
  EquipmentRequestViewSchema,
  UpdateEquipmentLineInputSchema,
  UpdateEquipmentRequestStatusInputSchema,
  type AddEquipmentLineOutcome,
  type CompleteReviewOutcome,
  type EquipmentQueueEntry,
  type EquipmentRequestStatus,
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
  unavailable: boolean;
  suitability: string | null;
  suitability_reason: string | null;
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
    unavailable: row.unavailable,
    suitability: row.suitability,
    suitabilityReason: row.suitability_reason,
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

type RequestRow = {
  technical_requirements: string | null;
  status: EquipmentRequestStatus;
  status_set_by: string | null;
  status_set_at: string | null;
  unable_reason: string | null;
  ready_to_reserve: boolean;
  review_completed_by: string | null;
  review_completed_at: string | null;
};

/** The event's request row, or null when no line or note has been saved yet. */
async function readRequest(eventRequestId: string): Promise<RequestRow | null> {
  const { data, error } = await fetchEquipmentRequest(eventRequestId);
  if (error) throw new ValidationError('The equipment request could not be read.', error.message);
  return (data as RequestRow | null) ?? null;
}

/**
 * SCRUM-166 AC2: the name of whoever set the status, the same way SCRUM-234's
 * safety check names who decided it. Null while nobody has (AC1).
 */
async function readSetByName(setBy: string | null): Promise<string | null> {
  if (setBy === null) return null;
  const { data } = await fetchProfileNames([setBy]);
  const name = (data as { id: string; full_name: string | null }[] | null)?.[0]?.full_name;
  return name && name.trim() !== '' ? name : 'An unnamed account';
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
  const request = await readRequest(event.id);

  return EquipmentRequestViewSchema.parse({
    eventRequestId: event.id,
    eventName: event.name,
    eventReference: event.reference,
    eventStatus: event.status,
    proposedDate: event.proposed_date,
    lines: await readLines(event.id),
    technicalRequirements: request?.technical_requirements ?? null,
    canEdit: isCoordinator && acceptsEquipmentRequest(event.status),
    // SCRUM-166 AC1, AC2: the stored status - under review until someone
    // sets it - with who set it and when, for both viewers.
    requestStatus: request
      ? {
          status: request.status,
          setByName: await readSetByName(request.status_set_by),
          setAt: request.status_set_at,
          unableReason: request.unable_reason,
        }
      : null,
    canSetStatus: request !== null && isActionPermitted(actor.roles, 'equipment_administration'),
    // SCRUM-171 AC4: the last completed review, for both viewers.
    review:
      request && request.review_completed_by && request.review_completed_at
        ? {
            readyToReserve: request.ready_to_reserve,
            completedByName: (await readSetByName(request.review_completed_by)) ?? 'An unnamed account',
            completedAt: request.review_completed_at,
          }
        : null,
    canReview: request !== null && isActionPermitted(actor.roles, 'equipment_administration'),
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

// -----------------------------------------------------------------------------
// SCRUM-166 — Update the status of an equipment request
// -----------------------------------------------------------------------------

/**
 * Technical Support Staff set an equipment request's status.
 *
 * AC2: "when I set its status to partially fulfilled, fulfilled or unable to
 * fulfil, then the new status, my identity and the timestamp are saved and
 * shown to the assigned coordinator." Only Technical Support Staff - the role
 * holding equipment_administration, as for the queue (SCRUM-164) and the
 * reservations (SCRUM-173) - may set it (TC-166-09). The identity saved is
 * the signed-in account's, never one from the body.
 *
 * AC3: partially fulfilled cannot be saved until the unavailable items are
 * marked (TC-166-11, TC-166-12). AC4: unable to fulfil cannot be saved without
 * a reason (TC-166-14, TC-166-15), and once it is, the event's assigned
 * coordinator - and nobody else (TC-166-16) - is notified (TC-166-13).
 *
 * Every rule is checked before anything is written, so a refusal leaves the
 * request as it was. Returns the request as it now reads.
 */
export async function updateEquipmentRequestStatus(
  eventRequestId: string,
  actor: Actor,
  input: unknown,
): Promise<EquipmentRequestView> {
  assertPermission([...actor.roles], 'equipment_administration');

  const parsed = UpdateEquipmentRequestStatusInputSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error, 'The status could not be saved.');

  const event = await readEvent(eventRequestId);
  if ((await readRequest(event.id)) === null) throw new NotFoundError('Equipment request');
  const lines = await readLines(event.id);

  const problem = statusUpdateProblem(
    parsed.data,
    lines.map((line) => line.id),
  );
  if (problem) {
    throw new ValidationError(problem.message, { formErrors: [], fieldErrors: { [problem.field]: [problem.message] } });
  }

  const update = statusUpdateToStore(parsed.data);
  const { data, error } = await setEquipmentRequestStatus({
    eventRequestId: event.id,
    status: update.status,
    unavailableLineIds: update.unavailableLineIds,
    reason: update.reason,
    setBy: actor.userId,
  });
  if (error) throw new ValidationError('The status could not be saved.', error.message);
  const outcome = (data as { outcome?: string } | null)?.outcome;
  if (outcome === 'not_found') throw new NotFoundError('Equipment request');
  if (outcome === 'unknown_line') {
    throw new ValidationError(UNKNOWN_LINE_MESSAGE, {
      formErrors: [],
      fieldErrors: { unavailableLineIds: [UNKNOWN_LINE_MESSAGE] },
    });
  }
  if (outcome !== 'saved') throw new ValidationError('The status could not be saved.');

  // AC4: the assigned coordinator, in-app (SCRUM-193). Best effort, as for every
  // notification: the status is already saved, and a failed notification must
  // not undo it.
  if (notifiesCoordinator(update.status) && event.coordinator_id && update.reason) {
    await notifyBestEffort({
      recipientId: event.coordinator_id,
      type: 'equipment_unable_to_fulfil',
      eventRequestId: event.id,
      message: unableToFulfilMessage({ reference: event.reference, name: event.name }, update.reason),
    });
  }

  return getEquipmentRequest(event.id, actor);
}

// -----------------------------------------------------------------------------
// SCRUM-171 — Assess whether requested equipment is suitable for the event
// -----------------------------------------------------------------------------

/** A check-constraint refusal from the database: a value got past the schema and policy. */
const NOT_SUITABLE_REASON_FALLBACK = 'The review could not be saved: each item not suitable needs a reason.';

/**
 * AC1: "Given an equipment requirement recorded against an event, when I
 * review it, then I can mark each requested item suitable or not suitable and
 * record why."
 *
 * Technical Support Staff only - the role holding equipment_administration, as
 * for the status (SCRUM-166) and reservations (SCRUM-173) - so a coordinator
 * is refused and nothing is saved (TC-171-05). The verdicts are saved together;
 * not suitable needs a reason (TC-171-02, TC-171-04), suitable does not
 * (TC-171-03). Who marked each item and when are recorded from the signed-in
 * account.
 *
 * AC2: an item saved as not suitable is an unmet requirement on the request,
 * with the reason (getEquipmentRequest returns the verdicts; the page lists
 * them, unmetRequirements). Nothing here touches the available quantity:
 * SCRUM-167 owns it (CL-50, TC-171-07).
 *
 * Every rule is checked before anything is written, so a refusal leaves every
 * item as it was. Returns the request as it now reads.
 */
export async function saveEquipmentSuitability(
  eventRequestId: string,
  actor: Actor,
  input: unknown,
): Promise<EquipmentRequestView> {
  assertPermission([...actor.roles], 'equipment_administration');

  const parsed = SaveSuitabilityInputSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error, 'The review could not be saved.');

  const event = await readEvent(eventRequestId);
  if ((await readRequest(event.id)) === null) throw new NotFoundError('Equipment request');
  const lines = await readLines(event.id);

  const problem = suitabilityProblem(
    parsed.data.verdicts,
    lines.map((line) => line.id),
  );
  if (problem) {
    throw new ValidationError(problem.message, {
      formErrors: [],
      fieldErrors: { [problem.field]: [problem.message] },
      lineIds: problem.lineIds,
    });
  }

  const { data, error } = await saveSuitabilityVerdicts({
    eventRequestId: event.id,
    verdicts: parsed.data.verdicts.map(suitabilityToStore),
    setBy: actor.userId,
  });
  if (error) {
    if (isCheckViolation(error)) throw new ValidationError(NOT_SUITABLE_REASON_FALLBACK, error.message);
    throw new ValidationError('The review could not be saved.', error.message);
  }
  const outcome = (data as { outcome?: string } | null)?.outcome;
  if (outcome === 'not_found') throw new NotFoundError('Equipment request');
  if (outcome === 'unknown_line') throw new ValidationError(UNKNOWN_SUITABILITY_LINE_MESSAGE);
  if (outcome !== 'saved') throw new ValidationError('The review could not be saved.');

  return getEquipmentRequest(event.id, actor);
}

/**
 * AC4: "Given every requested item is marked suitable and is available for the
 * commitment window, when I complete the review, then the request is marked
 * ready to reserve."
 *
 * "Available for the commitment window" is SCRUM-167's
 * checkEquipmentAvailability, run now: each item's quantity minus units out of
 * service (SCRUM-170) minus other events' reservations on the busiest day of
 * the window. An event with no approved venue booking has no window, so it is
 * not ready (167 AC3).
 *
 * A review can be completed with items unmarked; the request is then not ready
 * (TC-171-14). Each completion replaces the last, so completing again after a
 * change gives the current answer (TC-171-13). Later edits by the coordinator
 * do not change the mark in Release 1 (PO, 26 Oct 2026; SCRUM-265, CL-56).
 *
 * Returns the request as it now reads, and why it is not ready, if it is not.
 */
export async function completeEquipmentReview(eventRequestId: string, actor: Actor): Promise<CompleteReviewOutcome> {
  assertPermission([...actor.roles], 'equipment_administration');

  const event = await readEvent(eventRequestId);
  if ((await readRequest(event.id)) === null) throw new NotFoundError('Equipment request');
  const lines = await readLines(event.id);

  let availability: { lineId: string; shortfall: number }[] | null = null;
  let noWindowMessage = 'The availability check could not be run.';
  try {
    availability = (await checkEquipmentAvailability(event.id, actor)).lines;
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    noWindowMessage = error.message;
  }

  const notReady = notReadyReasons(
    lines.map((line) => ({ lineId: line.id, equipmentName: line.equipmentName, suitability: line.suitability })),
    availability,
    noWindowMessage,
  );

  const { data, error } = await setReviewCompleted({
    eventRequestId: event.id,
    readyToReserve: notReady.length === 0,
    completedBy: actor.userId,
  });
  if (error) throw new ValidationError('The review could not be completed.', error.message);
  if (!data) throw new NotFoundError('Equipment request');

  return CompleteReviewOutcomeSchema.parse({ request: await getEquipmentRequest(event.id, actor), notReady });
}
