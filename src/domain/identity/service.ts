import { createAdminClient } from '@/lib/supabase/server';
import { AccountRolesSchema, Role } from './roles';
import { ValidationError, NotFoundError } from '@/domain/shared/errors';

export async function getAccountRoles(accountId: string): Promise<Role[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('roles')
    .eq('id', accountId)
    .single();

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
  const { error } = await supabase
    .from('profiles')
    .update({ roles: parsed.data.roles })
    .eq('id', parsed.data.accountId);

  if (error) {
    throw new ValidationError('Could not update roles.', error.message);
  }
  return parsed.data.roles;
}