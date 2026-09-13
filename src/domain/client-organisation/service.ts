import { createAdminClient } from '@/lib/supabase/admin';
import {
  fetchClientOrganisation,
  insertClientOrganisation,
  listClientOrganisations as listClientOrganisationRows,
  listEventsForOrganisation,
  type ClientOrganisationRow,
  type OrganisationEventRow,
} from '@/lib/supabase/clientOrganisations';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, isUniqueViolation } from '@/domain/shared/errors';
import { CreateClientOrganisationInputSchema, type ClientOrganisation, type ClientOrganisationDetail } from './schema';
import { canManageClientOrganisations } from './policy';

/**
 * SCRUM-203 — create and maintain a client organisation. Decides who may act,
 * then delegates the actual Supabase calls to
 * src/lib/supabase/clientOrganisations.ts.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toClientOrganisation(row: ClientOrganisationRow): ClientOrganisation {
  return {
    id: row.id,
    name: row.name,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function requireCoordinator() {
  const actor = await getCurrentActor();
  if (!canManageClientOrganisations(actor.roles)) {
    throw new ForbiddenError('Only an Event Coordinator can manage client organisations.');
  }
  return actor;
}

function parseCreateInput(input: unknown) {
  const parsed = CreateClientOrganisationInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('The organisation is not valid.', parsed.error.flatten());
  }
  return parsed.data;
}

/** AC1 — a unique name and contact details, saved and available for selection. */
export async function createClientOrganisation(input: unknown): Promise<ClientOrganisation> {
  await requireCoordinator();
  const parsed = parseCreateInput(input);

  const { data, error } = await insertClientOrganisation(createAdminClient(), {
    name: parsed.name,
    contact_name: parsed.contactName ?? null,
    contact_email: parsed.contactEmail ?? null,
    contact_phone: parsed.contactPhone ?? null,
  });

  if (error) {
    // AC2 — a name already in use is refused, not silently overwritten.
    if (isUniqueViolation(error)) {
      throw new ConflictError('An organisation with this name already exists.');
    }
    throw new ValidationError('The organisation could not be saved.', error.message);
  }
  if (!data) throw new ValidationError('The organisation could not be saved.');
  return toClientOrganisation(data as unknown as ClientOrganisationRow);
}

/** AC1 — the list an event request selects a client organisation from. */
export async function listClientOrganisations(): Promise<ClientOrganisation[]> {
  await requireCoordinator();

  const { data, error } = await listClientOrganisationRows(createAdminClient());
  if (error) throw new ValidationError('Client organisations could not be read.', error.message);
  return (data ?? []).map((row) => toClientOrganisation(row as unknown as ClientOrganisationRow));
}

/** AC3 — an organisation's page lists the events recorded against it. */
export async function getClientOrganisation(id: string): Promise<ClientOrganisationDetail> {
  await requireCoordinator();
  if (!UUID_PATTERN.test(id)) throw new NotFoundError('Client organisation');

  const admin = createAdminClient();
  const { data: orgRow, error: orgError } = await fetchClientOrganisation(admin, id);
  if (orgError) throw new ValidationError('The organisation could not be read.', orgError.message);
  if (!orgRow) throw new NotFoundError('Client organisation');

  const { data: eventRows, error: eventsError } = await listEventsForOrganisation(admin, id);
  if (eventsError) throw new ValidationError('The organisation\'s events could not be read.', eventsError.message);

  return {
    ...toClientOrganisation(orgRow as unknown as ClientOrganisationRow),
    events: ((eventRows ?? []) as unknown as OrganisationEventRow[]).map((row) => ({
      id: row.id,
      reference: row.reference,
      name: row.name,
      status: row.status,
      proposedDate: row.proposed_date,
    })),
  };
}
