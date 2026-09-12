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
  eventRequestSaveSchema,
  type EventRequestSaveInput,
  type EventRequestStatus,
  type TimeSlot,
} from './schema';
import { canBeSubmitted, incompleteFields, isEditable } from './policy';

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
  clientOrganisationId: string;
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
    // The database constraint guarantees only AM/PM/NIGHT are ever stored.
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
  };
}

/**
 * AC1 — an Event Organiser always acts for their own client organisation. It is
 * read from the actor, never from the browser, so a request cannot be filed
 * against somebody else's organisation.
 */
function requireOrganiser(actor: Actor): { id: string; name: string } {
  if (!hasRole(actor.roles, 'event_organiser')) {
    throw new ForbiddenError('Only an Event Organiser can create an event request.');
  }
  if (actor.clientOrganisation === null) {
    throw new ValidationError(
      'Your account is not linked to a client organisation, so a request cannot be raised.',
    );
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
  if (request.organiserId !== actor.userId) {
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
  clientOrganisation: { id: string; name: string };
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
    client_organisation_id: clientOrganisation.id,
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
    throw new InvalidTransitionError(existing.status, 'DRAFT');
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
// SCRUM-82 — Submit a completed event request
// ---------------------------------------------------------------------------

/**
 * AC1 — a complete draft becomes SUBMITTED, with the submission time stamped
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
    throw new InvalidTransitionError(existing.status, 'SUBMITTED');
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
  if (!data) throw new InvalidTransitionError('SUBMITTED', 'SUBMITTED');
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
