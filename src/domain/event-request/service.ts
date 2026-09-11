import { createAdminClient } from '@/lib/supabase/admin';
import {
  fetchEventRequest,
  insertEventRequest,
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
import { eventRequestDraftSchema, type EventRequestDraft } from './schema';
import { submissionProblems } from './policy';

/**
 * SCRUM-76 — orchestration for event requests.
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
  timeSlots: string[] | null;
  expectedAttendance: number | null;
  status: 'DRAFT' | 'SUBMITTED';
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
    timeSlots: row.time_slots,
    expectedAttendance: row.expected_attendance,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toWrite(draft: EventRequestDraft): EventRequestWrite {
  return {
    name: draft.name,
    purpose: draft.purpose ?? null,
    description: draft.description ?? null,
    // Stored as a Singapore calendar date, not an instant.
    proposed_date: draft.proposedDate ? draft.proposedDate.toISOString().slice(0, 10) : null,
    time_slots: draft.timeSlots ?? null,
    expected_attendance: draft.expectedAttendance ?? null,
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

function requireOwnership(actor: Actor, request: EventRequest): void {
  if (request.organiserId !== actor.userId) {
    throw new ForbiddenError('This event request belongs to another organiser.');
  }
}

async function requireOwnRequest(actor: Actor, id: string): Promise<EventRequest> {
  // The id arrives from a URL. Postgres raises 22P02 on a malformed uuid, which
  // would surface as a 500 for what is really just a bad link.
  if (!UUID_PATTERN.test(id)) throw new NotFoundError('Event request');

  const { data, error } = await fetchEventRequest(createAdminClient(), id);
  if (error) throw new ValidationError('The event request could not be read.', error.message);
  if (!data) throw new NotFoundError('Event request');

  const request = toEventRequest(data as unknown as EventRequestRow);
  requireOwnership(actor, request);
  return request;
}

/** AC1 — the blank form needs the organiser's own organisation to pre-fill. */
export async function getNewEventRequestContext(): Promise<{
  organiserName: string;
  clientOrganisation: { id: string; name: string };
}> {
  const actor = await getCurrentActor();
  return { organiserName: actor.fullName, clientOrganisation: requireOrganiser(actor) };
}

/** AC2 — saving stores the request; the database hands it a unique reference. */
export async function createEventRequestDraft(input: unknown): Promise<EventRequest> {
  const actor = await getCurrentActor();
  const clientOrganisation = requireOrganiser(actor);

  const parsed = eventRequestDraftSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('The event request is not valid.', parsed.error.flatten());
  }

  const { data, error } = await insertEventRequest(createAdminClient(), {
    ...toWrite(parsed.data),
    organiser_id: actor.userId,
    client_organisation_id: clientOrganisation.id,
  });

  if (error || !data) {
    throw new ValidationError('The event request could not be saved.', error?.message);
  }
  return toEventRequest(data as unknown as EventRequestRow);
}

export async function updateEventRequestDraft(
  id: string,
  input: unknown,
): Promise<EventRequest> {
  const actor = await getCurrentActor();
  requireOrganiser(actor);

  const existing = await requireOwnRequest(actor, id);
  if (existing.status !== 'DRAFT') {
    throw new InvalidTransitionError(existing.status, 'DRAFT');
  }

  const parsed = eventRequestDraftSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('The event request is not valid.', parsed.error.flatten());
  }

  const { data, error } = await updateEventRequest(createAdminClient(), id, toWrite(parsed.data));
  if (error || !data) {
    throw new ValidationError('The event request could not be updated.', error?.message);
  }
  return toEventRequest(data as unknown as EventRequestRow);
}

export async function getEventRequest(id: string): Promise<EventRequest> {
  return requireOwnRequest(await getCurrentActor(), id);
}

/**
 * AC3 and AC4 — submission is refused for a date already past, and accepted for
 * every date from today onwards. A refusal leaves the draft exactly as it was,
 * which is what "saving it as a draft remains allowed" means in practice.
 */
export async function submitEventRequest(id: string): Promise<EventRequest> {
  const actor = await getCurrentActor();
  requireOrganiser(actor);

  const existing = await requireOwnRequest(actor, id);
  if (existing.status !== 'DRAFT') {
    throw new InvalidTransitionError(existing.status, 'SUBMITTED');
  }

  const problems = submissionProblems({
    name: existing.name,
    purpose: existing.purpose ?? undefined,
    description: existing.description ?? undefined,
    proposedDate: existing.proposedDate ? new Date(existing.proposedDate) : undefined,
    timeSlots: (existing.timeSlots ?? undefined) as EventRequestDraft['timeSlots'],
    expectedAttendance: existing.expectedAttendance ?? undefined,
  });

  if (problems.length > 0) {
    throw new ValidationError(problems[0] ?? 'This request cannot be submitted yet.', {
      problems,
    });
  }

  const { data, error } = await markEventRequestSubmitted(createAdminClient(), id);
  if (error) {
    throw new ValidationError('The event request could not be submitted.', error.message);
  }
  if (!data) throw new InvalidTransitionError(existing.status, 'SUBMITTED');
  return toEventRequest(data as unknown as EventRequestRow);
}
