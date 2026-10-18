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

/**
 * Every account holding the Event Coordinator role, for the picker an Event
 * Operations Manager assigns from.
 *
 * `contains` rather than `eq`: roles is a text[] and an account can hold more
 * than one, so this asks "is coordinator among them", not "is coordinator the
 * only one". Ordered by name because that is the order they are shown in.
 */
export async function listCoordinatorProfiles() {
  return createAdminClient()
    .from('profiles')
    .select('id, full_name, roles')
    .contains('roles', ['coordinator'])
    .order('full_name', { ascending: true });
}

/**
 * SCRUM-197 AC1 — every account holding the Event Coordinator Lead role
 * (`operations_manager` in code — the "Event Coordinator Lead" display name
 * is cosmetic only, CLAUDE.md "Agreed on day 1"), so each can be notified
 * that a newly submitted request needs a coordinator assigned.
 *
 * Same `contains` shape as listCoordinatorProfiles, for the same reason:
 * roles is a text[] and an account can hold more than one role.
 */
export async function listOperationsManagerProfiles() {
  return createAdminClient()
    .from('profiles')
    .select('id, full_name, roles')
    .contains('roles', ['operations_manager']);
}

/** SCRUM-148 AC1 — the names of the Venue Staff who decided a booking request's lines. */
export async function fetchProfileNames(accountIds: readonly string[]) {
  return createAdminClient().from('profiles').select('id, full_name').in('id', [...accountIds]);
}

/** SCRUM-204 — the caller's own profile, including organisation membership. */
export async function fetchProfileWithOrganisation(supabase: SupabaseClient, accountId: string) {
  return supabase
    .from('profiles')
    .select('full_name, roles, client_organisation_id')
    .eq('id', accountId)
    .maybeSingle();
}

/** SCRUM-204 AC1 — roles and current membership, read before assigning a new one. */
export async function fetchProfileRolesAndOrganisation(supabase: SupabaseClient, accountId: string) {
  return supabase.from('profiles').select('roles, client_organisation_id').eq('id', accountId).maybeSingle();
}

export async function updateProfileOrganisation(
  supabase: SupabaseClient,
  accountId: string,
  clientOrganisationId: string | null,
) {
  return supabase
    .from('profiles')
    .update({ client_organisation_id: clientOrganisationId })
    .eq('id', accountId);
}

/** SCRUM-204 AC1 — the Event Organiser accounts currently linked to an organisation. */
export async function listProfilesForOrganisation(supabase: SupabaseClient, clientOrganisationId: string) {
  return supabase
    .from('profiles')
    .select('id, full_name')
    .eq('client_organisation_id', clientOrganisationId)
    .contains('roles', ['event_organiser'])
    .order('full_name', { ascending: true });
}
