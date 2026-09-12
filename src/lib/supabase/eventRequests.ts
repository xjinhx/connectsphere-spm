import { SupabaseClient } from '@supabase/supabase-js';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import type { Decision } from '@/domain/review/schema';

/**
 * Supabase access for event requests. Thin by design: the query lives here, the
 * decision about whether to run it lives in domain/event-request/service.ts.
 */

const COLUMNS =
  'id, reference, organiser_id, client_organisation_id, name, purpose, description, proposed_date, ' +
  'time_slots, expected_attendance, status, submitted_at, created_at, updated_at, ' +
  // SCRUM-92
  'decision, decided_by, decided_at';

export interface EventRequestRow {
  id: string;
  reference: string;
  organiser_id: string;
  client_organisation_id: string;
  name: string;
  purpose: string | null;
  description: string | null;
  proposed_date: string | null;
  // Placeholders owned by SCRUM-77/78; read here so SCRUM-82 can judge
  // completeness once those tickets start filling them in.
  time_slots: string[] | null;
  expected_attendance: number | null;
  // SCRUM-82. Uses the shared type rather than a literal union, so adding a
  // status in one place cannot leave this row shape claiming the value is
  // impossible (SCRUM-92 added APPROVED).
  status: EventRequestStatus;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
  // SCRUM-92. All three are null together or set together
  // (event_request_decision_complete).
  decision: Decision | null;
  decided_by: string | null;
  decided_at: string | null;
}

export interface EventRequestWrite {
  name: string;
  purpose: string | null;
  description: string | null;
  proposed_date: string | null;
  // SCRUM-77. Null when none chosen, so "not yet provided" has one spelling.
  time_slots: string[] | null;
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
    .update({ status: 'SUBMITTED' })
    .eq('id', id)
    .eq('status', 'DRAFT')
    .select(COLUMNS)
    .maybeSingle();
}

// ---------------------------------------------------------------------------
// SCRUM-92 — Approve a request so planning can proceed
// ---------------------------------------------------------------------------

/**
 * AC1 — flips a submitted request to approved and records the decision and who
 * made it in the same statement. decided_at is stamped by the database (see
 * set_decided_at), so the caller cannot choose the time.
 *
 * The `status` filter is the guard: a request that is not SUBMITTED matches no
 * row and comes back empty, which is also what stops two coordinators
 * approving the same request at once. Same shape as
 * markEventRequestSubmitted above.
 */
export async function markEventRequestApproved(
  supabase: SupabaseClient,
  id: string,
  actorId: string,
) {
  return supabase
    .from('event_request')
    .update({ status: 'APPROVED', decision: 'APPROVED', decided_by: actorId })
    .eq('id', id)
    .eq('status', 'SUBMITTED')
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
    .eq('status', 'SUBMITTED')
    .order('submitted_at', { ascending: true });
}
