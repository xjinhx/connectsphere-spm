import { isRole, type Role } from '@/domain/identity/roles';
import { UnauthenticatedError } from '@/domain/shared/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import { createSessionClient } from '@/lib/supabase/server';
import { fetchProfileWithOrganisation } from '@/lib/supabase/profiles';
import { fetchClientOrganisation } from '@/lib/supabase/clientOrganisations';

/**
 * Who is making the current request.
 *
 * Built on the Authentication story's session (createSessionClient) and the
 * `profiles` row it maintains. Runs AS THE USER, so the profiles RLS policy
 * ("Users can view own profile") is what lets this read the row - nothing
 * here needs the service role.
 *
 * SCRUM-204 — clientOrganisation is read from profiles.client_organisation_id
 * (set via /api/accounts/[id]/organisation), then resolved to a name with the
 * admin client: client_organisations has deny-by-default RLS with no
 * authenticated-read policy (see 20260915100000_create_client_organisations),
 * so the session client alone cannot follow the join. Still null for internal
 * staff, and for an Event Organiser not yet linked to one (AC2).
 */
export interface Actor {
  userId: string;
  fullName: string;
  roles: Role[];
  clientOrganisation: { id: string; name: string } | null;
}

export async function getCurrentActor(): Promise<Actor> {
  const supabase = await createSessionClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new UnauthenticatedError();

  const { data: profile } = await fetchProfileWithOrganisation(supabase, user.id);

  let clientOrganisation: { id: string; name: string } | null = null;
  if (profile?.client_organisation_id) {
    const { data: org } = await fetchClientOrganisation(createAdminClient(), profile.client_organisation_id);
    clientOrganisation = org ? { id: org.id, name: org.name } : null;
  }

  return {
    userId: user.id,
    // `pnpm seed:users` does not set full_name, so fall back to the email.
    fullName: profile?.full_name ?? user.email ?? 'Unknown user',
    roles: ((profile?.roles as unknown[] | null) ?? []).filter(isRole),
    clientOrganisation,
  };
}
