import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase access for client organisations. Thin by design: the query lives
 * here, the decision about whether to run it lives in
 * domain/client-organisation/service.ts.
 */

const COLUMNS = 'id, name, contact_name, contact_email, contact_phone, created_at, updated_at';

export interface ClientOrganisationRow {
  id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientOrganisationWrite {
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
}

export interface OrganisationEventRow {
  id: string;
  reference: string;
  name: string;
  status: 'draft' | 'submitted';
  proposed_date: string | null;
}

export async function insertClientOrganisation(supabase: SupabaseClient, values: ClientOrganisationWrite) {
  return supabase.from('client_organisations').insert(values).select(COLUMNS).single();
}

export async function listClientOrganisations(supabase: SupabaseClient) {
  return supabase.from('client_organisations').select(COLUMNS).order('name', { ascending: true });
}

export async function fetchClientOrganisation(supabase: SupabaseClient, id: string) {
  return supabase.from('client_organisations').select(COLUMNS).eq('id', id).maybeSingle();
}

/** AC3 — events recorded against the organisation, most recently proposed first. */
export async function listEventsForOrganisation(supabase: SupabaseClient, organisationId: string) {
  return supabase
    .from('event_request')
    .select('id, reference, name, status, proposed_date')
    .eq('client_organisation_id', organisationId)
    .order('proposed_date', { ascending: false, nullsFirst: false });
}
