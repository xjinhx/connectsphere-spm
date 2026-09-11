import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase access for event requests. Thin by design: the query lives here, the
 * decision about whether to run it lives in domain/event-request/service.ts.
 */

const COLUMNS =
  'id, reference, organiser_id, client_organisation_id, name, purpose, description, proposed_date, created_at, updated_at';

export interface EventRequestRow {
  id: string;
  reference: string;
  organiser_id: string;
  client_organisation_id: string;
  name: string;
  purpose: string | null;
  description: string | null;
  proposed_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventRequestWrite {
  name: string;
  purpose: string | null;
  description: string | null;
  proposed_date: string | null;
}

export async function insertEventRequest(
  supabase: SupabaseClient,
  values: EventRequestWrite & { organiser_id: string; client_organisation_id: string },
) {
  return supabase.from('event_request').insert(values).select(COLUMNS).single();
}

export async function fetchEventRequest(supabase: SupabaseClient, id: string) {
  return supabase.from('event_request').select(COLUMNS).eq('id', id).maybeSingle();
}

export async function updateEventRequest(
  supabase: SupabaseClient,
  id: string,
  values: EventRequestWrite,
) {
  return supabase.from('event_request').update(values).eq('id', id).select(COLUMNS).single();
}
