import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase access for event requests. Thin by design: the query lives here, the
 * decision about whether to run it lives in domain/event-request/service.ts.
 */

const COLUMNS =
  'id, reference, organiser_id, client_organisation_id, name, purpose, description, proposed_date, ' +
  'time_slots, expected_attendance, status, submitted_at, created_at, updated_at';

export interface EventRequestRow {
  id: string;
  reference: string;
  organiser_id: string;
  client_organisation_id: string | null;
  name: string;
  purpose: string | null;
  description: string | null;
  proposed_date: string | null;
  // Placeholders owned by SCRUM-77/78; read here so SCRUM-82 can judge
  // completeness once those tickets start filling them in.
  time_slots: string[] | null;
  expected_attendance: number | null;
  // SCRUM-82
  status: 'draft' | 'submitted';
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventRequestWrite {
  name: string;
  purpose: string | null;
  description: string | null;
  proposed_date: string | null;
  // SCRUM-77. Null when none chosen, so "not yet provided" has one spelling.
  time_slots: string[] | null;
  // SCRUM-78's column. Optional on the write so SCRUM-76's create path, which
  // does not collect it, keeps compiling unchanged; SCRUM-83's draft save does
  // send it. See the note in domain/event-request/service.ts about the create
  // path still dropping this value.
  expected_attendance?: number | null;
}

export async function insertEventRequest(
  supabase: SupabaseClient,
  values: EventRequestWrite & { organiser_id: string; client_organisation_id: string | null },
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

// ---------------------------------------------------------------------------
// SCRUM-82 — Submit a completed event request
// ---------------------------------------------------------------------------

/**
 * AC1 — flips a draft to submitted; submitted_at is stamped by the database.
 * The `status` filter is what makes submitting twice impossible: a second
 * concurrent call matches no row and comes back empty rather than quietly
 * overwriting the first.
 */
export async function markEventRequestSubmitted(supabase: SupabaseClient, id: string) {
  return supabase
    .from('event_request')
    .update({ status: 'submitted' })
    .eq('id', id)
    .eq('status', 'draft')
    .select(COLUMNS)
    .maybeSingle();
}

/** AC3 — an organiser's own requests, newest first. */
export async function listEventRequestsForOrganiser(supabase: SupabaseClient, organiserId: string) {
  return supabase
    .from('event_request')
    .select(COLUMNS)
    .eq('organiser_id', organiserId)
    .order('created_at', { ascending: false });
}

/**
 * AC1 — the assignment queue: every submitted request, oldest submission first.
 * Only the query lives here; who may read it and where it is shown is
 * Coordinator Assignment's story.
 */
export async function listSubmittedEventRequests(supabase: SupabaseClient) {
  return supabase
    .from('event_request')
    .select(COLUMNS)
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: true });
}