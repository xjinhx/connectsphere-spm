import { createAdminClient } from '@/lib/supabase/admin';
import {
  fetchProfileRoles,
  fetchProfileRolesAndOrganisation,
  listProfilesForOrganisation,
  updateProfileOrganisation,
  updateProfileRoles,
} from '@/lib/supabase/profiles';
import { fetchClientOrganisation } from '@/lib/supabase/clientOrganisations';
import { isRole, AccountRolesSchema, Role } from './roles';
import { canAssignOrganisation } from './policy';
import { AssignOrganisationInputSchema, type AccountOrganisation, type LinkedOrganiser } from './schema';
import { ValidationError, NotFoundError } from '@/domain/shared/errors';

export async function getAccountRoles(accountId: string): Promise<Role[]> {
  const supabase = createAdminClient();
  const { data, error } = await fetchProfileRoles(supabase, accountId);

  if (error || !data) {
    throw new NotFoundError('Account');
  }
  return data.roles as Role[];
}

export async function setAccountRoles(accountId: string, roles: Role[]): Promise<Role[]> {
  const parsed = AccountRolesSchema.safeParse({ accountId, roles });
  if (!parsed.success) {
    throw new ValidationError('Invalid role assignment.', parsed.error.flatten());
  }

  const supabase = createAdminClient();
  const { error } = await updateProfileRoles(supabase, parsed.data.accountId, parsed.data.roles);

  if (error) {
    throw new ValidationError('Could not update roles.', error.message);
  }
  return parsed.data.roles;
}

/** SCRUM-204 AC1 — the organisation an account currently belongs to, if any. */
export async function getAccountOrganisation(accountId: string): Promise<AccountOrganisation> {
  const supabase = createAdminClient();
  const { data, error } = await fetchProfileRolesAndOrganisation(supabase, accountId);

  if (error || !data) {
    throw new NotFoundError('Account');
  }
  return { accountId, clientOrganisationId: data.client_organisation_id };
}

/**
 * SCRUM-204 AC1 — assign (or clear) the client organisation an Event
 * Organiser account belongs to. The caller's permission to act at all is
 * checked by the route (assertPermission); this additionally confirms the
 * target account is actually an Event Organiser, and that the organisation
 * id, if given, is real.
 */
export async function setAccountOrganisation(accountId: string, input: unknown): Promise<AccountOrganisation> {
  const parsed = AssignOrganisationInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('Invalid organisation assignment.', parsed.error.flatten());
  }

  const supabase = createAdminClient();
  const { data: profile, error: profileError } = await fetchProfileRolesAndOrganisation(supabase, accountId);
  if (profileError || !profile) {
    throw new NotFoundError('Account');
  }

  const targetRoles = ((profile.roles as unknown[] | null) ?? []).filter(isRole);
  if (!canAssignOrganisation(targetRoles)) {
    throw new ValidationError('Only an Event Organiser account can be linked to a client organisation.');
  }

  if (parsed.data.clientOrganisationId) {
    const { data: org, error: orgError } = await fetchClientOrganisation(parsed.data.clientOrganisationId);
    if (orgError) throw new ValidationError('The organisation could not be verified.', orgError.message);
    if (!org) throw new NotFoundError('Client organisation');
  }

  const { error } = await updateProfileOrganisation(supabase, accountId, parsed.data.clientOrganisationId);
  if (error) {
    throw new ValidationError('Could not update the organisation membership.', error.message);
  }
  return { accountId, clientOrganisationId: parsed.data.clientOrganisationId };
}

/** SCRUM-204 AC1 — the Event Organiser accounts currently linked to an organisation, for its page. */
export async function listOrganisersForOrganisation(clientOrganisationId: string): Promise<LinkedOrganiser[]> {
  const supabase = createAdminClient();
  const { data, error } = await listProfilesForOrganisation(supabase, clientOrganisationId);
  if (error) throw new ValidationError('Linked Event Organisers could not be read.', error.message);

  return (data ?? []).map((row) => ({
    accountId: row.id,
    fullName: row.full_name ?? 'Unnamed account',
  }));
}