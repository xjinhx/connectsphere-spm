import { SupabaseClient } from '@supabase/supabase-js';
import { Role } from '@/domain/identity/roles';
import { createAdminClient } from './admin';

export async function fetchProfileRoles(supabase: SupabaseClient, accountId: string) {
  return supabase.from('profiles').select('roles').eq('id', accountId).single();
}

export async function updateProfileRoles(supabase: SupabaseClient, accountId: string, roles: Role[]) {
  return supabase.from('profiles').update({ roles }).eq('id', accountId);
}

// ---------------------------------------------------------------------------
// SCRUM-94 — Assign an Event Coordinator to a submitted event
// ---------------------------------------------------------------------------
// The client lives here rather than in the caller, so domain/assignment/
// service.ts never holds one (docs/architecture.md rule 3). The two functions
// above predate that wording and still take the client as a parameter; they are
// left as they are rather than refactored from this story.

/**
 * AC1 needs the person's roles, to refuse assigning someone who is not an Event
 * Coordinator; AC5 needs their name, to tell the second manager who holds the
 * event. One read answers both.
 */
export async function fetchProfileSummary(accountId: string) {
  return createAdminClient()
    .from('profiles')
    .select('id, full_name, roles')
    .eq('id', accountId)
    .maybeSingle();
}
