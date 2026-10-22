import { cookies } from 'next/headers';
import { isRole, type Role } from '@/domain/identity/roles';
import { resolveWorkingRole, WORKING_AS_COOKIE } from '@/domain/navigation/policy';
import { createSessionClient } from '@/lib/supabase/server';
import { fetchProfileWithOrganisation } from '@/lib/supabase/profiles';

/**
 * SCRUM-249 — what the shared header needs about the signed-in account.
 *
 * Separate from getCurrentActor() because the header needs the email and the
 * raw name (null when none is recorded, AC2), where Actor.fullName already
 * falls back to the email. Runs as the user, like getCurrentActor().
 */
export interface SignedInAccount {
  email: string;
  fullName: string | null;
  roles: Role[];
  /** AC5 — the role chosen in "Working as", or the default role. */
  workingRole: Role;
}

/** Null when nobody is signed in. */
export async function getSignedInAccount(): Promise<SignedInAccount | null> {
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await fetchProfileWithOrganisation(supabase, user.id);
  const roles = ((profile?.roles as unknown[] | null) ?? []).filter(isRole);
  const chosen = (await cookies()).get(WORKING_AS_COOKIE)?.value;

  return {
    email: user.email ?? '',
    fullName: profile?.full_name ?? null,
    roles,
    workingRole: resolveWorkingRole(roles, chosen),
  };
}
