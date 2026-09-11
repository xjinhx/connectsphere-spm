import { createAdminClient } from '@/lib/supabase/admin';
import {
  fetchEventRequest,
  insertEventRequest,
  updateEventRequest,
  type EventRequestRow,
  type EventRequestWrite,
} from '@/lib/supabase/eventRequests';
import { getCurrentActor, type Actor } from '@/lib/auth/currentActor';
import { hasRole } from '@/domain/identity/policy';
import { ForbiddenError, NotFoundError, ValidationError } from '@/domain/shared/errors';
import { eventRequestBasicDetailsSchema, type EventRequestBasicDetails } from './schema';

/**
 * SCRUM-76 — orchestration for creating and reading an event request.
 * Decides who may act, validates, then delegates the actual Supabase calls to
 * src/lib/supabase/eventRequests.ts. Submission is SCRUM-82 and lives there.
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toWrite(details: EventRequestBasicDetails): EventRequestWrite {
  return {
    name: details.name,
    purpose: details.purpose,
    description: details.description,
    // Stored as a calendar date, not an instant.
    proposed_date: details.proposedDate.toISOString().slice(0, 10),
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

function parseBasicDetails(input: unknown): EventRequestBasicDetails {
  const parsed = eventRequestBasicDetailsSchema.safeParse(input);
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
    ...toWrite(parseBasicDetails(input)),
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
  await requireOwnRequest(actor, id);

  const { data, error } = await updateEventRequest(
    createAdminClient(),
    id,
    toWrite(parseBasicDetails(input)),
  );
  if (error || !data) {
    throw new ValidationError('The event request could not be updated.', error?.message);
  }
  return toEventRequest(data as unknown as EventRequestRow);
}

export async function getEventRequest(id: string): Promise<EventRequest> {
  return requireOwnRequest(await getCurrentActor(), id);
}
