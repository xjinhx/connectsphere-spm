import { isRole, type Role } from '@/domain/identity/roles';
import { UnauthenticatedError } from '@/domain/shared/errors';
import { createSessionClient } from '@/lib/supabase/server';

/**
 * Who is making the current request.
 *
 * Built on the Authentication story's session (createSessionClient) and the
 * `profiles` row it maintains. Runs AS THE USER, so the profiles RLS policy
 * ("Users can view own profile") is what lets this read the row - nothing
 * here needs the service role.
 *
 * clientOrganisation is null for everyone until the Client Organisations
 * story lands: there is no table or column to read it from yet. SCRUM-76 AC1
 * (organisation pre-filled on the form) is blocked on that, and nothing else.
 */
export interface Actor {
  userId: string;
  fullName: string;
  roles: Role[];
  /** Null for internal staff - and, for now, for everyone (see above). */
  clientOrganisation: { id: string; name: string } | null;
}

export async function getCurrentActor(): Promise<Actor> {
  const supabase = await createSessionClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new UnauthenticatedError();

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, roles')
    .eq('id', user.id)
    .maybeSingle();

  return {
    userId: user.id,
    // `pnpm seed:users` does not set full_name, so fall back to the email.
    fullName: profile?.full_name ?? user.email ?? 'Unknown user',
    roles: ((profile?.roles as unknown[] | null) ?? []).filter(isRole),
    clientOrganisation: null,
  };
}
