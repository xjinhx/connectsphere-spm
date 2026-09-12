import { SupabaseClient } from '@supabase/supabase-js';
import { Role } from '@/domain/identity/roles';

export async function fetchProfileRoles(supabase: SupabaseClient, accountId: string) {
  return supabase.from('profiles').select('roles').eq('id', accountId).single();
}

export async function updateProfileRoles(supabase: SupabaseClient, accountId: string, roles: Role[]) {
  return supabase.from('profiles').update({ roles }).eq('id', accountId);
}