import { createAdminClient } from './admin';

// ---------------------------------------------------------------------------
// SCRUM-187 — Request a change and track its outcome
// ---------------------------------------------------------------------------
// Per docs/architecture.md (rule 3), both the Supabase client and the query
// live here, so domain/change-request/service.ts never holds a client.

const CHANGE_REQUEST_COLUMNS =
  'id, event_request_id, organiser_id, reason, status, decided_by, decided_at, decision_reason, created_at';
const FIELD_COLUMNS = 'id, change_request_id, field, current_value, proposed_value';

export interface ChangeRequestRow {
  id: string;
  event_request_id: string;
  organiser_id: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  created_at: string;
}

export interface ChangeRequestFieldRow {
  id: string;
  change_request_id: string;
  field: string;
  current_value: unknown;
  proposed_value: unknown;
}

/** AC1 — the request row, its status always starting Pending (table default). */
export async function insertChangeRequest(values: {
  event_request_id: string;
  organiser_id: string;
  reason: string;
}) {
  return createAdminClient()
    .from('change_request')
    .insert(values)
    .select(CHANGE_REQUEST_COLUMNS)
    .single();
}

/** AC1 — one row per selected field, each carrying its own current/proposed value. */
export async function insertChangeRequestFields(
  rows: { change_request_id: string; field: string; current_value: unknown; proposed_value: unknown }[],
) {
  return createAdminClient().from('change_request_field').insert(rows).select(FIELD_COLUMNS);
}

/** AC6 — every change request raised against an event, newest first. */
export async function listChangeRequestsForEvent(eventRequestId: string) {
  return createAdminClient()
    .from('change_request')
    .select(CHANGE_REQUEST_COLUMNS)
    .eq('event_request_id', eventRequestId)
    .order('created_at', { ascending: false });
}

/** AC6 — the field lines belonging to a set of change requests, read in one query. */
export async function listChangeRequestFields(changeRequestIds: string[]) {
  return createAdminClient().from('change_request_field').select(FIELD_COLUMNS).in('change_request_id', changeRequestIds);
}

// ---------------------------------------------------------------------------
// SCRUM-191 — Reject a change request with a reason
// ---------------------------------------------------------------------------

/** Read one change request by id, to check it is Pending before deciding it. */
export async function fetchChangeRequestById(id: string) {
  return createAdminClient().from('change_request').select(CHANGE_REQUEST_COLUMNS).eq('id', id).maybeSingle();
}

/**
 * AC1 — sets status='rejected' and stores the decision reason. decided_at is
 * stamped by the database (change_request_set_decided_at trigger), the same
 * "one clock" pattern as event_request's set_decided_at, so it is never
 * caller-supplied. `.eq('status', 'pending')` makes the Pending check race-safe:
 * if the CR was decided between the read in rejectChangeRequest() and this
 * write, the update matches no row and `data` comes back null.
 */
export async function rejectChangeRequestRow(id: string, values: { decided_by: string; decision_reason: string }) {
  return createAdminClient()
    .from('change_request')
    .update({ status: 'rejected', decided_by: values.decided_by, decision_reason: values.decision_reason })
    .eq('id', id)
    .eq('status', 'pending')
    .select(CHANGE_REQUEST_COLUMNS)
    .maybeSingle();
}
