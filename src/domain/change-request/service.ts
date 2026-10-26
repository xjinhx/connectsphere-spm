import {
  fetchChangeRequestById,
  insertChangeRequest,
  insertChangeRequestFields,
  listChangeRequestFields,
  listChangeRequestsForEvent,
  rejectChangeRequestRow,
  type ChangeRequestFieldRow,
  type ChangeRequestRow,
} from '@/lib/supabase/changeRequests';
import { fetchEventRequestById, type EventRequestRow } from '@/lib/supabase/eventRequests';
import { canViewRequest } from '@/domain/event-request/policy';
import { timeRangeIssues } from '@/domain/event-request/schema';
import { notifyBestEffort } from '@/domain/notification/service';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/domain/shared/errors';
import { fromDatabaseTime } from '@/domain/shared/times';
import {
  ChangeRequestIdSchema,
  EventRequestIdSchema,
  RaiseChangeRequestInputSchema,
  RejectChangeRequestInputSchema,
  type ChangeRequestStatus,
  type SelectableChangeRequestField,
} from './schema';
import {
  canDecideChangeRequestFor,
  canRaiseChangeRequest,
  canRaiseChangeRequestFor,
  isPendingChangeRequest,
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
    // DUMMY(SCRUM-190) D-24: read back as-is until that story's own write
    // lands. SCRUM-191's reject path now writes these (rejectChangeRequest,
    // this file); see docs/dummies.md D-24.
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
 * belong to the approve/reject stories.
 * DUMMY(SCRUM-190) D-24: decided_by/decided_at/decision_reason (still
 * unwritten until that story lands; SCRUM-191's reject path now writes them,
 * see rejectChangeRequest below).
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

/**
 * SCRUM-191 — Reject a change request with a reason.
 *
 * AC1 — "Given a pending change request, when I reject it with a reason,
 * then its status becomes Rejected and the reason is stored."
 * AC2 — rejecting never touches the event's own fields: unlike
 * raiseChangeRequest/toSummary, nothing here writes to event_request, so
 * opening the event afterwards shows none of the requested values applied.
 * AC3 — the organiser who raised it is notified, with the reason included.
 * AC4 — a blank/whitespace-only reason is refused by
 * RejectChangeRequestInputSchema before anything is read, and the message is
 * surfaced through handleApiError the same way as every other validation
 * failure.
 *
 * Who may reject: the event's currently assigned coordinator only
 * (canDecideChangeRequestFor, reusing isCurrentCoordinator), same "not yours"
 * pattern as requireCurrentCoordinator (domain/assignment/service.ts) and
 * every other coordinator-only action in this codebase.
 *
 * DUMMY(SCRUM-191) D-24: replaced here — this function now writes
 * decided_by/decision_reason/status; decided_at is stamped by the database
 * (change_request_set_decided_at trigger, see the migration added with this
 * PR). See docs/dummies.md. SCRUM-190's own write (approve) is a separate,
 * still-open dummy until that story lands.
 */
export async function rejectChangeRequest(
  eventRequestId: string,
  changeRequestId: string,
  coordinatorId: string,
  input: unknown,
): Promise<ChangeRequestSummary> {
  const parsedEventId = EventRequestIdSchema.safeParse(eventRequestId);
  if (!parsedEventId.success) throw new NotFoundError('Event request');

  const parsedCrId = ChangeRequestIdSchema.safeParse(changeRequestId);
  if (!parsedCrId.success) throw new NotFoundError('Change request');

  // AC4 — validated before anything is read, so an organiser can never be
  // told "not assigned to you" for a request that would have been refused on
  // the reason alone anyway.
  const parsedInput = RejectChangeRequestInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new ValidationError('A reason is required to reject a change request.', parsedInput.error.flatten());
  }
  const { reason } = parsedInput.data;

  const event = await readRequest(parsedEventId.data);

  // Refused before the change request itself is revealed, same reasoning as
  // every other "not yours" check in this codebase (requireCurrentCoordinator).
  if (!canDecideChangeRequestFor({ coordinatorId: event.coordinator_id }, coordinatorId)) {
    throw new ForbiddenError('This event is not assigned to you.');
  }

  const { data: crData, error: crError } = await fetchChangeRequestById(parsedCrId.data);
  if (crError) {
    throw new ValidationError('The change request could not be read.', crError.message);
  }
  if (!crData) throw new NotFoundError('Change request');
  const cr = crData as unknown as ChangeRequestRow;

  if (cr.event_request_id !== parsedEventId.data) {
    throw new NotFoundError('Change request');
  }

  if (!isPendingChangeRequest(cr.status)) {
    throw new ConflictError('This change request has already been decided.');
  }

  const { data: updated, error: updateError } = await rejectChangeRequestRow(parsedCrId.data, {
    decided_by: coordinatorId,
    decision_reason: reason,
  });
  if (updateError) {
    throw new ValidationError('The change request could not be rejected.', updateError.message);
  }
  if (!updated) {
    // Raced: decided by someone else (or itself, twice) between the read
    // above and this write. Same reasoning as the Pending check itself.
    throw new ConflictError('This change request has already been decided.');
  }
  const rejectedRow = updated as unknown as ChangeRequestRow;

  // AC3 — "the Event Organiser who raised the CR is notified with the
  // recorded reason." Best-effort, same pattern as every other notification
  // in this codebase: the rejection has already been saved, so a
  // notification failure here must never undo it.
  await notifyBestEffort({
    recipientId: cr.organiser_id,
    type: 'change_request_rejected',
    eventRequestId: parsedEventId.data,
    message: `Your change request for "${event.name}" was rejected: ${reason}`,
  });

  const { data: fieldRows, error: fieldsError } = await listChangeRequestFields([rejectedRow.id]);
  if (fieldsError) {
    throw new ValidationError('The changed fields could not be read.', fieldsError.message);
  }

  return toSummary(rejectedRow, (fieldRows ?? []) as unknown as ChangeRequestFieldRow[]);
}

export { ChangeRequestIdSchema };
