import type { Role } from '@/domain/identity/roles';
import { UnauthenticatedError } from '@/domain/shared/errors';

/**
 * Who is making the current request.
 *
 * NOT IMPLEMENTED. This is the seam between the Authentication story (which
 * owns the session) and the Client Organisations story (which owns the
 * organisation a user belongs to). Neither exists yet, so this throws rather
 * than inventing an identity model that would collide with both.
 *
 * To implement: read the session with createSessionClient() from
 * @/lib/supabase/server, load the matching `profiles` row for the roles, and
 * resolve the organisation. Nothing else in the codebase needs to change.
 */
export interface Actor {
  userId: string;
  fullName: string;
  roles: Role[];
  /** Null for internal staff, who do not act for a client organisation. */
  clientOrganisation: { id: string; name: string } | null;
}

export async function getCurrentActor(): Promise<Actor> {
  throw new UnauthenticatedError(
    'Sign-in is not available yet - getCurrentActor() is implemented by the Authentication story.',
  );
}
