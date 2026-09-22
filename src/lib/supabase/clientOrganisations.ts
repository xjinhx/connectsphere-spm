import { SupabaseClient } from '@supabase/supabase-js';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import { createAdminClient } from './admin';

/**
 * Supabase access for client organisations. Thin by design: the query lives
 * here, the decision about whether to run it lives in
 * domain/client-organisation/service.ts. Per docs/architecture.md (rule 3),
 * the client lives here too, same as SCRUM-92/94/96, so the service never
 * holds one.
 */

const COLUMNS = 'id, name, contact_name, contact_email, contact_phone, created_at, updated_at';

/** createAdminClient memoises its client, so calling it per query is free. */
function db(): SupabaseClient {
  return createAdminClient();
}

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
  status: EventRequestStatus;
  proposed_date: string | null;
}

export async function insertClientOrganisation(values: ClientOrganisationWrite) {
  return db().from('client_organisations').insert(values).select(COLUMNS).single();
}

export async function listClientOrganisations() {
  return db().from('client_organisations').select(COLUMNS).order('name', { ascending: true });
}

export async function fetchClientOrganisation(id: string) {
  return db().from('client_organisations').select(COLUMNS).eq('id', id).maybeSingle();
}

export async function updateClientOrganisation(id: string, values: ClientOrganisationWrite) {
  return db().from('client_organisations').update(values).eq('id', id).select(COLUMNS).maybeSingle();
}

/** AC3 — events recorded against the organisation, most recently proposed first. */
export async function listEventsForOrganisation(organisationId: string) {
  return db()
    .from('event_request')
    .select('id, reference, name, status, proposed_date')
    .eq('client_organisation_id', organisationId)
    .order('proposed_date', { ascending: false, nullsFirst: false });
}
