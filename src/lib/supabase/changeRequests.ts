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
// SCRUM-190 — Approve a change request and apply it
// ---------------------------------------------------------------------------

/** AC1/AC2/AC4/AC5/AC6 — the one request being decided. */
export async function fetchChangeRequestById(id: string) {
  return createAdminClient().from('change_request').select(CHANGE_REQUEST_COLUMNS).eq('id', id).maybeSingle();
}

/**
 * AC1, AC2, AC4, AC6 — one call to approve_change_request, which applies the
 * event update, flips the change request to Approved and flags every
 * affected arrangement in one transaction (the same shape as
 * change_event_schedule, src/lib/supabase/eventSchedule.ts). Resolves to
 * {"outcome": ...}; see the migration for each outcome.
 */
export async function approveChangeRequestRow(params: {
  changeRequestId: string;
  coordinatorId: string;
  name: string;
  purpose: string | null;
  description: string | null;
  proposedDate: string | null;
  startTime: string | null;
  endTime: string | null;
  expectedAttendance: number | null;
  roomLayout: string | null;
  accessibilityRequired: boolean | null;
  accessibilityNotes: string | null;
  accessibilityFeatureIds: string[];
  preferredLocationId: string | null;
  equipmentRequired: boolean | null;
  equipmentItems: { item: string; quantity: number }[];
  technicalSupportNotes: string | null;
  registrationRequired: boolean | null;
  bookingCause: string | null;
  reservationCause: string | null;
  dropToPlanning: boolean;
}) {
  return createAdminClient().rpc('approve_change_request', {
    p_change_request_id: params.changeRequestId,
    p_coordinator_id: params.coordinatorId,
    p_name: params.name,
    p_purpose: params.purpose,
    p_description: params.description,
    p_proposed_date: params.proposedDate,
    p_start_time: params.startTime,
    p_end_time: params.endTime,
    p_expected_attendance: params.expectedAttendance,
    p_room_layout: params.roomLayout,
    p_accessibility_required: params.accessibilityRequired,
    p_accessibility_notes: params.accessibilityNotes,
    p_accessibility_feature_ids: params.accessibilityFeatureIds,
    p_preferred_location_id: params.preferredLocationId,
    p_equipment_required: params.equipmentRequired,
    p_equipment_items: params.equipmentItems,
    p_technical_support_notes: params.technicalSupportNotes,
    p_registration_required: params.registrationRequired,
    p_booking_cause: params.bookingCause,
    p_reservation_cause: params.reservationCause,
    p_drop_to_planning: params.dropToPlanning,
  });
}
