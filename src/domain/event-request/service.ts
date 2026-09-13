import { createAdminClient } from '@/lib/supabase/admin';
import {
  fetchEventRequest,
  insertEventRequest,
  listEventRequestsForOrganiser,
  markEventRequestSubmitted,
  updateEventRequest,
  type EventRequestRow,
  type EventRequestWrite,
} from '@/lib/supabase/eventRequests';
import { getCurrentActor, type Actor } from '@/lib/auth/currentActor';
import { hasRole } from '@/domain/identity/policy';
import {
  ForbiddenError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
} from '@/domain/shared/errors';
import {
  eventRequestDraftSchema,
  eventRequestSaveSchema,
  type EventRequestDraftInput,
  type EventRequestSaveInput,
  type EventRequestStatus,
  type TimeSlot,
} from './schema';
import { canBeSubmitted, incompleteFields, isEditable, isOwnRequest, isResumable } from './policy';

/**
 * SCRUM-76 — orchestration for creating and reading an event request.
 * SCRUM-82 — submitting one, and listing an organiser's own.
 * Decides who may act, applies the rules from policy.ts, then delegates the
 * actual Supabase calls to src/lib/supabase/eventRequests.ts.
 */

export interface EventRequest {
  id: string;
  reference: string;
  organiserId: string;
  /** Null until the Client Organisations story lands. */
  clientOrganisationId: string | null;
  name: string;
  purpose: string | null;
  description: string | null;
  proposedDate: string | null;
  /** SCRUM-77. Null until at least one slot has been chosen. */
  timeSlots: TimeSlot[] | null;
  /** SCRUM-78's column, read here for SCRUM-82's completeness check. */
  expectedAttendance: number | null;
  // SCRUM-82
  status: EventRequestStatus;
  /** An instant. Render with formatSingaporeDateTime() (AC1). */
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toEventRequest(row: EventRequestRow): EventRequest {
  return {
    id: row.id,
    reference: row.reference,
    organiserId: row.organiser_id,
    clientOrganisationId: row.client_organisation_id,
    name: row.name,
    purpose: row.purpose,
    description: row.description,
    proposedDate: row.proposed_date,
    // The database constraint guarantees only am/pm/night are ever stored.
    timeSlots: row.time_slots as TimeSlot[] | null,
    expectedAttendance: row.expected_attendance,
    status: row.status,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toWrite(input: EventRequestSaveInput): EventRequestWrite {
  return {
    name: input.name,
    purpose: input.purpose,
    description: input.description,
    // Stored as a calendar date, not an instant.
    proposed_date: input.proposedDate.toISOString().slice(0, 10),
    // SCRUM-77 AC1: the chosen slots, already deduplicated and in day order.
    time_slots: input.timeSlots.length > 0 ? input.timeSlots : null,
    // SCRUM-78. Was previously dropped on the create path entirely - the
    // draft path (toDraftWrite, SCRUM-83) already wrote this correctly.
    expected_attendance: input.expectedAttendance ?? null,
  };
}

/**
 * AC1 — an Event Organiser always acts for their own client organisation. It is
 * read from the actor, never from the browser, so a request cannot be filed
 * against somebody else's organisation.
 *
 * Interim: the organisation may be null until the Client Organisations story
 * lands (see lib/auth/currentActor.ts). Creating without one is allowed for
 * now rather than blocking every organiser; the story that adds organisations
 * should make this throw again.
 */
function requireOrganiser(actor: Actor): { id: string; name: string } | null {
  if (!hasRole(actor.roles, 'event_organiser')) {
    throw new ForbiddenError('Only an Event Organiser can create an event request.');
  }
  return actor.clientOrganisation;
}

async function requireOwnRequest(actor: Actor, id: string): Promise<EventRequest> {
  // The id arrives from a URL. Postgres raises 22P02 on a malformed uuid, which
  // would surface as a 500 for what is really just a bad link.
  if (!UUID_PATTERN.test(id)) throw new NotFoundError('Event request');

  const { data, error } = await fetchEventRequest(createAdminClient(), id);
  if (error) throw new ValidationError('The event request could not be read.', error.message);
  if (!data) throw new NotFoundError('Event request');

  const request = toEventRequest(data as unknown as EventRequestRow);
  // SCRUM-83 AC3 — the rule itself lives in policy.ts so it can be tested
  // without a database; this is where it is applied.
  if (!isOwnRequest(request, actor.userId)) {
    throw new ForbiddenError('This event request belongs to another organiser.');
  }
  return request;
}

function parseSaveInput(input: unknown): EventRequestSaveInput {
  const parsed = eventRequestSaveSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('The event request is not valid.', parsed.error.flatten());
  }
  return parsed.data;
}

/** AC1 — the blank form needs the organiser's own organisation to pre-fill. */
export async function getNewEventRequestContext(): Promise<{
  organiserName: string;
  clientOrganisation: { id: string; name: string } | null;
}> {
  const actor = await getCurrentActor();
  return { organiserName: actor.fullName, clientOrganisation: requireOrganiser(actor) };
}

/**
 * AC2 — saving stores the request; the database hands it a unique reference.
 * AC3 — all four fields are required, but the date's value is never checked
 * on save. That is what keeps a request with a date still to be fixed savable.
 */
export async function createEventRequest(input: unknown): Promise<EventRequest> {
  const actor = await getCurrentActor();
  const clientOrganisation = requireOrganiser(actor);

  const { data, error } = await insertEventRequest(createAdminClient(), {
    ...toWrite(parseSaveInput(input)),
    organiser_id: actor.userId,
    client_organisation_id: clientOrganisation?.id ?? null,
  });

  if (error || !data) {
    throw new ValidationError('The event request could not be saved.', error?.message);
  }
  return toEventRequest(data as unknown as EventRequestRow);
}

export async function updateEventRequestDetails(id: string, input: unknown): Promise<EventRequest> {
  const actor = await getCurrentActor();
  requireOrganiser(actor);
  const existing = await requireOwnRequest(actor, id);

  // SCRUM-82 AC4 — a submitted request is read-only. The page hides the edit
  // action; this is the same rule where it cannot be bypassed.
  if (!isEditable(existing.status)) {
    throw new InvalidTransitionError(existing.status, 'draft');
  }

  const { data, error } = await updateEventRequest(
    createAdminClient(),
    id,
    toWrite(parseSaveInput(input)),
  );
  if (error || !data) {
    throw new ValidationError('The event request could not be updated.', error?.message);
  }
  return toEventRequest(data as unknown as EventRequestRow);
}

export async function getEventRequest(id: string): Promise<EventRequest> {
  return requireOwnRequest(await getCurrentActor(), id);
}

// ---------------------------------------------------------------------------
// SCRUM-83 — Save an incomplete request as a draft
// SCRUM-85 — Resume editing a draft
// ---------------------------------------------------------------------------

function parseDraftInput(input: unknown): EventRequestDraftInput {
  const parsed = eventRequestDraftSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('The draft could not be saved.', parsed.error.flatten());
  }
  return parsed.data;
}

/**
 * A draft writes every field it was given and nulls the rest. Null, not
 * "leave alone": re-saving a draft after clearing a field has to clear it in
 * the row too, or the form and the record would disagree (SCRUM-85 AC3 shows
 * the organiser exactly what is stored).
 */
function toDraftWrite(input: EventRequestDraftInput): EventRequestWrite {
  return {
    name: input.name,
    purpose: input.purpose ?? null,
    description: input.description ?? null,
    proposed_date: input.proposedDate ? input.proposedDate.toISOString().slice(0, 10) : null,
    // SCRUM-77's constraint: no slots is NULL, never an empty array.
    time_slots: input.timeSlots.length > 0 ? input.timeSlots : null,
    expected_attendance: input.expectedAttendance ?? null,
  };
}

/**
 * SCRUM-83 AC1 — saves whatever has been filled in. No mandatory-field check
 * runs here: that is the whole point of the action, and it is what separates
 * this from createEventRequest() above. The row lands as draft because the
 * column defaults to it.
 */
export async function saveEventRequestDraft(input: unknown): Promise<EventRequest> {
  const actor = await getCurrentActor();
  const clientOrganisation = requireOrganiser(actor);

  const { data, error } = await insertEventRequest(createAdminClient(), {
    ...toDraftWrite(parseDraftInput(input)),
    organiser_id: actor.userId,
    client_organisation_id: clientOrganisation?.id ?? null,
  });

  if (error || !data) {
    throw new ValidationError('The draft could not be saved.', error?.message);
  }
  return toEventRequest(data as unknown as EventRequestRow);
}

/**
 * SCRUM-83 AC4 — saving again while editing a draft updates that same draft.
 * An UPDATE on the id, never an insert, so no second draft can appear.
 *
 * SCRUM-85 AC3 — this is also the save behind resumed editing.
 */
export async function updateEventRequestDraft(id: string, input: unknown): Promise<EventRequest> {
  const actor = await getCurrentActor();
  requireOrganiser(actor);

  const existing = await requireOwnRequest(actor, id);
  // A submitted request is read-only (SCRUM-82 AC4). Enforced here, not only
  // by hiding the form, so a direct API call cannot get around it.
  if (!isResumable(existing.status)) {
    throw new InvalidTransitionError(existing.status, 'draft');
  }

  const { data, error } = await updateEventRequest(
    createAdminClient(),
    id,
    toDraftWrite(parseDraftInput(input)),
  );
  if (error || !data) {
    throw new ValidationError('The draft could not be saved.', error?.message);
  }
  return toEventRequest(data as unknown as EventRequestRow);
}

/**
 * SCRUM-85 AC3 — reopen a draft for editing, with everything previously
 * entered still on it. Refuses anything that is no longer a draft, so the
 * edit page cannot be reached for a submitted request by typing its URL.
 */
export async function getEventRequestDraftForEditing(id: string): Promise<EventRequest> {
  const actor = await getCurrentActor();
  const request = await requireOwnRequest(actor, id);

  if (!isResumable(request.status)) {
    throw new InvalidTransitionError(request.status, 'draft');
  }
  return request;
}

// ---------------------------------------------------------------------------
// SCRUM-82 — Submit a completed event request
// ---------------------------------------------------------------------------

/**
 * AC1 — a complete draft becomes submitted, with the submission time stamped
 * by the database. It is in the assignment queue from that moment, because
 * the queue is defined as "every submitted request" (see
 * listSubmittedEventRequests in src/lib/supabase/eventRequests.ts).
 *
 * AC2 — an incomplete draft is refused with every incomplete field named, and
 * nothing about it changes, so it stays editable.
 */
export async function submitEventRequest(id: string): Promise<EventRequest> {
  const actor = await getCurrentActor();
  requireOrganiser(actor);

  const existing = await requireOwnRequest(actor, id);
  if (!canBeSubmitted(existing.status)) {
    throw new InvalidTransitionError(existing.status, 'submitted');
  }

  const incomplete = incompleteFields(existing);
  if (incomplete.length > 0) {
    throw new ValidationError(
      'The request cannot be submitted until every mandatory field is complete.',
      { incompleteFields: incomplete },
    );
  }

  const { data, error } = await markEventRequestSubmitted(createAdminClient(), id);
  if (error) {
    throw new ValidationError('The event request could not be submitted.', error.message);
  }
  // No row matched: another call submitted it first (see the `status` filter).
  if (!data) throw new InvalidTransitionError('submitted', 'submitted');
  return toEventRequest(data as unknown as EventRequestRow);
}

/** AC3 — the organiser's own event list: reference, status and submission date. */
export async function listMyEventRequests(): Promise<EventRequest[]> {
  const actor = await getCurrentActor();
  requireOrganiser(actor);

  const { data, error } = await listEventRequestsForOrganiser(createAdminClient(), actor.userId);
  if (error) throw new ValidationError('Your event requests could not be read.', error.message);
  return (data ?? []).map((row) => toEventRequest(row as unknown as EventRequestRow));
}