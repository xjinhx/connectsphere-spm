import { createAdminClient } from '@/lib/supabase/admin';
import { fetchProfileRoles, updateProfileRoles } from '@/lib/supabase/profiles';
import { AccountRolesSchema, Role } from './roles';
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