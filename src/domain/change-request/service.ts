import {
  approveChangeRequestRow,
  fetchChangeRequestById,
  insertChangeRequest,
  insertChangeRequestFields,
  listChangeRequestFields,
  listChangeRequestsForEvent,
  type ChangeRequestFieldRow,
  type ChangeRequestRow,
} from '@/lib/supabase/changeRequests';
import { fetchEventRequestById, type EventRequestRow } from '@/lib/supabase/eventRequests';
import { fetchRegisteredAttendeeIds } from '@/lib/supabase/eventRegistrations';
import { canViewRequest } from '@/domain/event-request/policy';
import { timeRangeIssues } from '@/domain/event-request/schema';
import type { ScheduleValues } from '@/domain/significant-change/schema';
import { RoomLayoutSchema, type RoomLayout } from '@/domain/venues/schema';
import { notifyBestEffort } from '@/domain/notification/service';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/domain/shared/errors';
import { fromDatabaseTime } from '@/domain/shared/times';
import {
  ChangeRequestAccessibilityFeatureIdsSchema,
  ChangeRequestEquipmentItemSchema,
  ChangeRequestIdSchema,
  EventRequestIdSchema,
  RaiseChangeRequestInputSchema,
  type ChangeRequestEquipmentItem,
  type ChangeRequestStatus,
  type SelectableChangeRequestField,
} from './schema';
import {
  arrangementReviewMessage,
  attendeeChangeMessage,
  canDecideChangeRequestFor,
  canRaiseChangeRequest,
  canRaiseChangeRequestFor,
  changeAffectsAttendees,
  changeRequestArrangementCauses,
  changeRequestIsSignificant,
  type AttendeeFacingDetails,
  type ChangeRequestExtras,
} from './policy';

/**
 * SCRUM-187 — Request a change and track its outcome.
 *
 * Orchestration only: validates input, applies policy.ts's rules, and calls
 * src/lib/supabase/changeRequests.ts. Per docs/architecture.md (rule 3) it
 * never imports a Supabase client or builds a query itself.
 */

export interface ChangeRequestFieldChange {
  field: SelectableChangeRequestField;
  currentValue: unknown;
  proposedValue: unknown;
}

export interface ChangeRequestSummary {
  id: string;
  status: ChangeRequestStatus;
  reason: string;
  fields: ChangeRequestFieldChange[];
  createdAt: string;
  /** AC6 — null until SCRUM-190/191 record a decision. */
  decidedAt: string | null;
  decisionReason: string | null;
}

async function readRequest(id: string): Promise<EventRequestRow> {
  const { data, error } = await fetchEventRequestById(id);
  if (error) throw new ValidationError('The event request could not be read.', error.message);
  if (!data) throw new NotFoundError('Event request');
  return data as unknown as EventRequestRow;
}

/** EVENT_REQUEST_CORE_FIELDS: how each selectable field reads off an event-request row. */
const CURRENT_VALUE_READERS: Record<SelectableChangeRequestField, (event: EventRequestRow) => unknown> = {
  name: (event) => event.name,
  purpose: (event) => event.purpose,
  description: (event) => event.description,
  proposedDate: (event) => event.proposed_date,
  // Postgres `time` reads back as `HH:MM:SS`; the proposed value comes from an
  // <input type="time"> as `HH:MM` (ClockTime, src/domain/shared/times.ts).
  // Normalised here so the two are displayed on the same footing.
  startTime: (event) => (event.start_time ? fromDatabaseTime(event.start_time) : event.start_time),
  endTime: (event) => (event.end_time ? fromDatabaseTime(event.end_time) : event.end_time),
  expectedAttendance: (event) => event.expected_attendance,
  roomLayout: (event) => event.room_layout,
  accessibilityRequired: (event) => event.accessibility_required,
  // Nested through the link table, the same way fetchEventRequestById reads
  // it for the event page itself.
  accessibilityFeatureIds: (event) =>
    event.event_request_accessibility_features
      .map((link) => link.accessibility_features?.id)
      .filter((id): id is string => id !== null && id !== undefined),
  accessibilityNotes: (event) => event.accessibility_notes,
  preferredLocationId: (event) => event.preferred_location?.id ?? null,
  equipmentRequired: (event) => event.equipment_required,
  equipmentItems: (event) => event.event_request_equipment,
  technicalSupportNotes: (event) => event.technical_support_notes,
  registrationRequired: (event) => event.registration_required,
};

/** The proposed value for `field` if it was selected, else the event's current one (both ClockTime strings, or undefined if neither is set). */
function asClockTimeOrCurrent(
  proposedByField: Map<SelectableChangeRequestField, unknown>,
  field: 'startTime' | 'endTime',
  event: EventRequestRow,
): string | undefined {
  const proposed = proposedByField.get(field);
  if (typeof proposed === 'string') return proposed;
  const current = CURRENT_VALUE_READERS[field](event);
  return typeof current === 'string' ? current : undefined;
}

function toSummary(row: ChangeRequestRow, fieldRows: ChangeRequestFieldRow[]): ChangeRequestSummary {
  return {
    id: row.id,
    status: row.status,
    reason: row.reason,
    fields: fieldRows
      .filter((field) => field.change_request_id === row.id)
      .map((field) => ({
        field: field.field as SelectableChangeRequestField,
        currentValue: field.current_value,
        proposedValue: field.proposed_value,
      })),
    createdAt: row.created_at,
    // Read back as-is. Written for real by approveChangeRequest below for an
    // approved decision; DUMMY(SCRUM-191) D-26 remains Active for a rejected
    // one until that story writes it. See docs/dummies.md.
    decidedAt: row.decided_at,
    decisionReason: row.decision_reason,
  };
}

/**
 * AC1 — "Given my event has been submitted or confirmed, when I raise a
 * change request by selecting each field to change, entering its proposed
 * value and giving a reason, then the request is created with status
 * Pending, stores the current value of each selected field alongside the
 * proposed value, and the assigned coordinator is notified."
 *
 * AC2 — a Draft event is edited directly (SCRUM-76/83); this throws for one,
 * same as any other non-eligible status (canRaiseChangeRequest).
 * AC4 — only the responsible organiser may raise one; a colleague who can
 * view the event (canViewRequest) is refused.
 * AC5 — Cancelled/Completed events are refused, same path as AC2.
 *
 * decided_by/decided_at/decision_reason are never written here - they
 * belong to the approve/reject stories (approveChangeRequest below, for the
 * approved path; DUMMY(SCRUM-191) D-26 remains Active for the rejected one).
 * See docs/dummies.md.
 */
export async function raiseChangeRequest(
  eventRequestId: string,
  input: unknown,
  actorId: string,
): Promise<ChangeRequestSummary> {
  const parsedId = EventRequestIdSchema.safeParse(eventRequestId);
  if (!parsedId.success) throw new NotFoundError('Event request');

  const parsedInput = RaiseChangeRequestInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new ValidationError('The change request is not valid.', parsedInput.error.flatten());
  }
  const { fields, reason } = parsedInput.data;

  const event = await readRequest(parsedId.data);

  // Refused before anything else is revealed, same reasoning as every other
  // "not yours" check in this codebase (respondToClarification).
  if (!canRaiseChangeRequestFor({ organiserId: event.organiser_id }, actorId)) {
    throw new ForbiddenError('This event request belongs to another organiser.');
  }

  if (!canRaiseChangeRequest(event.status)) {
    throw new ConflictError('A change request cannot be raised on this event in its current status.');
  }

  // Bug found manually testing TC-187-03: selecting only one of startTime/
  // endTime (or both, inverted) could propose an end before a start, since
  // nothing checked the pair. Same rule as the event request's own save
  // (timeRangeIssues, domain/event-request/schema.ts) - a field left
  // unselected keeps its current value for the comparison, since that is
  // what the event would actually end up with if this request is approved.
  const proposedByField = new Map(fields.map(({ field, proposedValue }) => [field, proposedValue]));
  if (proposedByField.has('startTime') || proposedByField.has('endTime')) {
    const effectiveStart = asClockTimeOrCurrent(proposedByField, 'startTime', event);
    const effectiveEnd = asClockTimeOrCurrent(proposedByField, 'endTime', event);
    const issues = timeRangeIssues(effectiveStart, effectiveEnd);
    if (issues.length > 0) {
      throw new ValidationError(issues[0]?.message ?? 'The end time must be after the start time.', issues);
    }
  }

  const { data: created, error: createError } = await insertChangeRequest({
    event_request_id: parsedId.data,
    organiser_id: actorId,
    reason,
  });
  if (createError) {
    throw new ValidationError('The change request could not be created.', createError.message);
  }
  if (!created) {
    throw new ValidationError('The change request could not be created.');
  }
  const row = created as unknown as ChangeRequestRow;

  const fieldRowsToInsert = fields.map(({ field, proposedValue }) => ({
    change_request_id: row.id,
    field,
    current_value: CURRENT_VALUE_READERS[field](event) ?? null,
    proposed_value: proposedValue,
  }));
  const { data: insertedFields, error: fieldsError } = await insertChangeRequestFields(fieldRowsToInsert);
  if (fieldsError) {
    throw new ValidationError('The changed fields could not be saved.', fieldsError.message);
  }

  // AC1's "the assigned coordinator is notified", through the existing
  // in-app mechanism (SCRUM-193/198) — same best-effort pattern as every
  // other notification in this codebase: the change request has already
  // been saved, so a notification failure here must never undo it.
  if (event.coordinator_id) {
    await notifyBestEffort({
      recipientId: event.coordinator_id,
      type: 'change_requested',
      eventRequestId: parsedId.data,
      message: `A change was requested for "${event.name}": ${reason}`,
    });
  }

  return toSummary(row, (insertedFields ?? []) as unknown as ChangeRequestFieldRow[]);
}

/**
 * AC6 — "Given I have raised change requests, when I open my event, then
 * each is listed with what was asked, its status, the decision date and any
 * reason given."
 *
 * Who may read: the same rule as the event page itself (canViewRequest) -
 * the owning organiser, or a colleague in the same client organisation once
 * the request has left Draft (SCRUM-204 AC3).
 */
export async function listChangeRequests(
  eventRequestId: string,
  actor: { userId: string; clientOrganisationId: string | null },
): Promise<ChangeRequestSummary[]> {
  const parsedId = EventRequestIdSchema.safeParse(eventRequestId);
  if (!parsedId.success) throw new NotFoundError('Event request');

  const event = await readRequest(parsedId.data);

  if (
    !canViewRequest(
      {
        organiserId: event.organiser_id,
        clientOrganisationId: event.client_organisation_id,
        status: event.status,
      },
      actor,
    )
  ) {
    throw new NotFoundError('Event request');
  }

  const { data: requestRows, error: requestsError } = await listChangeRequestsForEvent(parsedId.data);
  if (requestsError) {
    throw new ValidationError('The change requests could not be read.', requestsError.message);
  }
  const requests = (requestRows ?? []) as unknown as ChangeRequestRow[];
  if (requests.length === 0) return [];

  const { data: fieldRows, error: fieldsError } = await listChangeRequestFields(requests.map((r) => r.id));
  if (fieldsError) {
    throw new ValidationError('The changed fields could not be read.', fieldsError.message);
  }
  const fields = (fieldRows ?? []) as unknown as ChangeRequestFieldRow[];

  return requests.map((row) => toSummary(row, fields));
}

// -----------------------------------------------------------------------------
// SCRUM-190 — Approve a change request and apply it
// -----------------------------------------------------------------------------

function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string') throw new ValidationError(message);
  return value;
}

function requireStringOrNull(value: unknown, message: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  throw new ValidationError(message);
}

function requireNumberOrNull(value: unknown, message: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  throw new ValidationError(message);
}

function requireBooleanOrNull(value: unknown, message: string): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  throw new ValidationError(message);
}

function requireRoomLayoutOrNull(value: unknown, message: string): RoomLayout | null {
  if (value === null || value === undefined) return null;
  const parsed = RoomLayoutSchema.safeParse(value);
  if (!parsed.success) throw new ValidationError(message);
  return parsed.data;
}

function parseAccessibilityFeatureIds(value: unknown): string[] {
  const parsed = ChangeRequestAccessibilityFeatureIdsSchema.safeParse(value ?? []);
  if (!parsed.success) {
    throw new ValidationError('The proposed accessibility features are not valid.', parsed.error.flatten());
  }
  return parsed.data;
}

function parseEquipmentItems(value: unknown): ChangeRequestEquipmentItem[] {
  const parsed = ChangeRequestEquipmentItemSchema.array().safeParse(value ?? []);
  if (!parsed.success) {
    throw new ValidationError('The proposed equipment items are not valid.', parsed.error.flatten());
  }
  return parsed.data;
}

/** Every selected field's proposed value, by field. */
function proposedValueMap(
  fields: readonly ChangeRequestFieldChange[],
): Map<SelectableChangeRequestField, unknown> {
  return new Map(fields.map((entry) => [entry.field, entry.proposedValue]));
}

/** The value `field` would end up with if this request is approved: proposed if selected, else what the event already has. */
function effectiveValue(
  field: SelectableChangeRequestField,
  proposed: Map<SelectableChangeRequestField, unknown>,
  event: EventRequestRow,
): unknown {
  return proposed.has(field) ? proposed.get(field) : CURRENT_VALUE_READERS[field](event);
}

async function readChangeRequest(id: string): Promise<{ row: ChangeRequestRow; fields: ChangeRequestFieldRow[] }> {
  const { data, error } = await fetchChangeRequestById(id);
  if (error) throw new ValidationError('The change request could not be read.', error.message);
  if (!data) throw new NotFoundError('Change request');
  const row = data as unknown as ChangeRequestRow;

  const { data: fieldRows, error: fieldsError } = await listChangeRequestFields([row.id]);
  if (fieldsError) throw new ValidationError('The changed fields could not be read.', fieldsError.message);

  return { row, fields: (fieldRows ?? []) as unknown as ChangeRequestFieldRow[] };
}

/**
 * AC1 — "Given a pending change request, when the assigned coordinator
 * approves it, then the event is updated with the requested values and the
 * request's status becomes Approved."
 *
 * AC2/AC3 — if the approved change is significant (changeRequestIsSignificant,
 * policy.ts) and the event was Confirmed, it returns to Planning; it cannot be
 * re-confirmed until every arrangement that is both essential and flagged for
 * review has been re-confirmed (essential-arrangements/policy.ts's
 * outstandingReviewArrangements, read by event-status/service.ts's
 * confirmEvent — not duplicated here). An affected arrangement that is not
 * essential never blocks, however flagged.
 *
 * AC4 — every venue booking / equipment reservation the change affects
 * (changeRequestArrangementCauses, reusing SCRUM-111's changeCauses as-is) is
 * flagged for review, and the staff who actioned it (decided_by/reserved_by)
 * is notified, through the existing in-app mechanism (SCRUM-193/198).
 *
 * AC5 — when the change alters a detail attendees are shown (its name,
 * description, date or times: changeAffectsAttendees, policy.ts), every
 * attendee with a Registered registration is notified of the new details.
 * A registration belongs to the signed-in Attendee account that made it
 * (SCRUM-181, event_registration.attendee_id), so the in-app mechanism
 * reaches them; no email (SCRUM-194 is out of Release 1).
 *
 * AC6 — the organiser who raised it is notified it was approved.
 *
 * Replaces DUMMY(SCRUM-190) D-26 for the approved path: decided_by/
 * decided_at are now written for real here. SCRUM-191's half of D-26 (the
 * rejected path) stays Active until that story writes it.
 */
export async function approveChangeRequest(
  eventRequestId: string,
  changeRequestId: string,
  actorId: string,
): Promise<ChangeRequestSummary> {
  const parsedEventId = EventRequestIdSchema.safeParse(eventRequestId);
  if (!parsedEventId.success) throw new NotFoundError('Event request');
  const parsedCrId = ChangeRequestIdSchema.safeParse(changeRequestId);
  if (!parsedCrId.success) throw new NotFoundError('Change request');

  const { row: cr, fields } = await readChangeRequest(parsedCrId.data);
  if (cr.event_request_id !== parsedEventId.data) throw new NotFoundError('Change request');

  const event = await readRequest(parsedEventId.data);

  if (!canDecideChangeRequestFor({ coordinatorId: event.coordinator_id }, actorId)) {
    throw new ForbiddenError('This event is not assigned to you.');
  }
  if (cr.status !== 'pending') {
    throw new ConflictError('This change request has already been decided.');
  }

  const proposed = proposedValueMap(fields.map((f) => ({ field: f.field as SelectableChangeRequestField, currentValue: f.current_value, proposedValue: f.proposed_value })));

  const scheduleBefore: ScheduleValues = {
    proposedDate: requireStringOrNull(CURRENT_VALUE_READERS.proposedDate(event), 'The event date is not valid.'),
    startTime: requireStringOrNull(CURRENT_VALUE_READERS.startTime(event), 'The event start time is not valid.'),
    endTime: requireStringOrNull(CURRENT_VALUE_READERS.endTime(event), 'The event end time is not valid.'),
    expectedAttendance: requireNumberOrNull(CURRENT_VALUE_READERS.expectedAttendance(event), 'The expected attendance is not valid.'),
    roomLayout: requireRoomLayoutOrNull(CURRENT_VALUE_READERS.roomLayout(event), 'The room layout is not valid.'),
    accessibilityRequired: requireBooleanOrNull(CURRENT_VALUE_READERS.accessibilityRequired(event), 'The accessibility answer is not valid.'),
    accessibilityNotes: requireStringOrNull(CURRENT_VALUE_READERS.accessibilityNotes(event), 'The accessibility notes are not valid.'),
  };
  const scheduleAfter: ScheduleValues = {
    proposedDate: requireStringOrNull(effectiveValue('proposedDate', proposed, event), 'The proposed date is not valid.'),
    startTime: requireStringOrNull(effectiveValue('startTime', proposed, event), 'The proposed start time is not valid.'),
    endTime: requireStringOrNull(effectiveValue('endTime', proposed, event), 'The proposed end time is not valid.'),
    expectedAttendance: requireNumberOrNull(
      effectiveValue('expectedAttendance', proposed, event),
      'The proposed expected attendance is not valid.',
    ),
    roomLayout: requireRoomLayoutOrNull(effectiveValue('roomLayout', proposed, event), 'The proposed room layout is not valid.'),
    accessibilityRequired: requireBooleanOrNull(
      effectiveValue('accessibilityRequired', proposed, event),
      'The proposed accessibility answer is not valid.',
    ),
    accessibilityNotes: requireStringOrNull(
      effectiveValue('accessibilityNotes', proposed, event),
      'The proposed accessibility notes are not valid.',
    ),
  };

  const extrasBefore: ChangeRequestExtras = {
    preferredLocationId: requireStringOrNull(CURRENT_VALUE_READERS.preferredLocationId(event), 'The preferred location is not valid.'),
    accessibilityFeatureIds: parseAccessibilityFeatureIds(CURRENT_VALUE_READERS.accessibilityFeatureIds(event)),
    equipmentRequired: requireBooleanOrNull(CURRENT_VALUE_READERS.equipmentRequired(event), 'The equipment answer is not valid.'),
    equipmentItems: parseEquipmentItems(CURRENT_VALUE_READERS.equipmentItems(event)),
    technicalSupportNotes: requireStringOrNull(CURRENT_VALUE_READERS.technicalSupportNotes(event), 'The technical support notes are not valid.'),
  };
  const extrasAfter: ChangeRequestExtras = {
    preferredLocationId: requireStringOrNull(
      effectiveValue('preferredLocationId', proposed, event),
      'The proposed preferred location is not valid.',
    ),
    accessibilityFeatureIds: parseAccessibilityFeatureIds(effectiveValue('accessibilityFeatureIds', proposed, event)),
    equipmentRequired: requireBooleanOrNull(
      effectiveValue('equipmentRequired', proposed, event),
      'The proposed equipment answer is not valid.',
    ),
    equipmentItems: parseEquipmentItems(effectiveValue('equipmentItems', proposed, event)),
    technicalSupportNotes: requireStringOrNull(
      effectiveValue('technicalSupportNotes', proposed, event),
      'The proposed technical support notes are not valid.',
    ),
  };

  const significant = changeRequestIsSignificant({ ...scheduleBefore, ...extrasBefore }, { ...scheduleAfter, ...extrasAfter });
  const causes = changeRequestArrangementCauses(scheduleBefore, scheduleAfter);

  const nameAfter = requireString(effectiveValue('name', proposed, event), 'The event name is required.');
  const descriptionAfter = requireStringOrNull(effectiveValue('description', proposed, event), 'The proposed description is not valid.');
  // AC5 — what registered attendees are shown, before and after.
  const attendeeBefore: AttendeeFacingDetails = {
    name: event.name,
    description: event.description ?? null,
    proposedDate: scheduleBefore.proposedDate,
    startTime: scheduleBefore.startTime,
    endTime: scheduleBefore.endTime,
  };
  const attendeeAfter: AttendeeFacingDetails = {
    name: nameAfter,
    description: descriptionAfter,
    proposedDate: scheduleAfter.proposedDate,
    startTime: scheduleAfter.startTime,
    endTime: scheduleAfter.endTime,
  };

  const { data, error } = await approveChangeRequestRow({
    changeRequestId: parsedCrId.data,
    coordinatorId: actorId,
    name: nameAfter,
    purpose: requireStringOrNull(effectiveValue('purpose', proposed, event), 'The proposed purpose is not valid.'),
    description: descriptionAfter,
    proposedDate: scheduleAfter.proposedDate,
    startTime: scheduleAfter.startTime,
    endTime: scheduleAfter.endTime,
    expectedAttendance: scheduleAfter.expectedAttendance,
    roomLayout: scheduleAfter.roomLayout,
    accessibilityRequired: scheduleAfter.accessibilityRequired,
    accessibilityNotes: scheduleAfter.accessibilityNotes,
    accessibilityFeatureIds: extrasAfter.accessibilityFeatureIds as string[],
    preferredLocationId: extrasAfter.preferredLocationId,
    equipmentRequired: extrasAfter.equipmentRequired,
    equipmentItems: extrasAfter.equipmentItems as ChangeRequestEquipmentItem[],
    technicalSupportNotes: extrasAfter.technicalSupportNotes,
    registrationRequired: requireBooleanOrNull(
      effectiveValue('registrationRequired', proposed, event),
      'The proposed registration answer is not valid.',
    ),
    bookingCause: causes.booking,
    reservationCause: causes.reservation,
    dropToPlanning: significant,
  });
  if (error || !data) {
    throw new ValidationError('The change request could not be approved.', error?.message);
  }

  const result = data as {
    outcome: string;
    bookings?: string[];
    reservations?: string[];
    venueStaffIds?: string[];
    equipmentStaffIds?: string[];
  };
  switch (result.outcome) {
    case 'not_found':
      throw new NotFoundError('Change request');
    case 'not_pending':
      throw new ConflictError('This change request has already been decided.');
    case 'event_not_found':
      throw new NotFoundError('Event request');
    case 'not_assigned':
      throw new ForbiddenError('This event is not assigned to you.');
    case 'approved':
      break;
    default:
      throw new ValidationError('The change request could not be approved.', result);
  }

  // AC6 — best effort, same pattern as every other notification in this
  // codebase: the decision has already been saved, so a failure here must
  // never undo it.
  await notifyBestEffort({
    recipientId: event.organiser_id,
    type: 'change_request_approved',
    eventRequestId: event.id,
    message: `Your change request for "${event.name}" was approved.`,
  });

  // AC4 — the staff who actioned each affected arrangement, one notification
  // each, saying what changed on the kind(s) they actioned.
  const venueStaff = new Set(result.venueStaffIds ?? []);
  const equipmentStaff = new Set(result.equipmentStaffIds ?? []);
  for (const staffId of new Set([...venueStaff, ...equipmentStaff])) {
    await notifyBestEffort({
      recipientId: staffId,
      type: 'arrangement_needs_review',
      eventRequestId: event.id,
      message: arrangementReviewMessage(event.name, {
        booking: venueStaff.has(staffId) ? causes.booking : null,
        reservation: equipmentStaff.has(staffId) ? causes.reservation : null,
      }),
    });
  }

  // AC5 — every attendee with a Registered registration, when the change
  // alters a detail they are shown. Best effort, like the two above.
  if (changeAffectsAttendees(attendeeBefore, attendeeAfter)) {
    const { data: registered, error: registeredError } = await fetchRegisteredAttendeeIds(event.id);
    if (registeredError) {
      console.error('Could not read the registered attendees to notify', event.id, registeredError.message);
    }
    const message = attendeeChangeMessage(attendeeAfter);
    for (const attendeeId of new Set((registered ?? []).map((row) => row.attendee_id))) {
      await notifyBestEffort({ recipientId: attendeeId, type: 'event_details_changed', eventRequestId: event.id, message });
    }
  }

  const { row: decided, fields: decidedFields } = await readChangeRequest(parsedCrId.data);
  return toSummary(decided, decidedFields);
}

export { ChangeRequestIdSchema };
