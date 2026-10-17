import { SupabaseClient } from '@supabase/supabase-js';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import type { Decision } from '@/domain/review/schema';
import { createAdminClient } from './admin';

/**
 * Supabase access for event requests. Thin by design: the query lives here, the
 * decision about whether to run it lives in domain/event-request/service.ts.
 */

const COLUMNS =
  'id, reference, organiser_id, client_organisation_id, name, purpose, description, proposed_date, ' +
  'time_slots, start_time, end_time, expected_attendance, status, submitted_at, created_at, updated_at, ' +
  // SCRUM-79. The chosen accessibility features come back nested through the
  // link table, the same way a venue's do in lib/supabase/venues.ts.
  'room_layout, accessibility_required, accessibility_notes, ' +
  'event_request_accessibility_features ( accessibility_features ( id, name ) ), ' +
  'preferred_location:locations ( id, name ), ' +
  'client_organisation:client_organisations ( id, name ), ' +
  // SCRUM-80
  'equipment_required, technical_support_notes, ' +
  'event_request_equipment ( position, item, quantity ), ' +
  // SCRUM-81
  'registration_required, ' +
  // SCRUM-92 / SCRUM-93
  'decision, decided_by, decided_at, rejection_reason, ' +
  // SCRUM-94
  'coordinator_id, assigned_by, assigned_at, ' +
  // SCRUM-90
  'clarification_note, clarification_requested_by, clarification_requested_at';

export interface ReferenceRow {
  id: string;
  name: string;
}

export interface EquipmentRow {
  position: number;
  item: string;
  quantity: number;
}

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
  // SCRUM-238. Postgres `time` ('10:00:00', '24:00:00'), Singapore clock time;
  // null together until entered. Filled from time_slots for older rows (AC6).
  start_time: string | null;
  end_time: string | null;
  expected_attendance: number | null;
  // SCRUM-82. Uses the shared type rather than a literal union, so adding a
  // status in one place cannot leave this row shape claiming the value is
  // impossible (SCRUM-92 added approved).
  status: EventRequestStatus;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
  // SCRUM-79. The check constraint guarantees only the seven catalogue layouts.
  room_layout: string | null;
  accessibility_required: boolean | null;
  accessibility_notes: string | null;
  event_request_accessibility_features: { accessibility_features: ReferenceRow | null }[];
  /** Null is "no preference" (AC4). */
  preferred_location: ReferenceRow | null;
  /** Null until an organiser has been linked to a client organisation. */
  client_organisation: ReferenceRow | null;
  // SCRUM-80
  equipment_required: boolean | null;
  technical_support_notes: string | null;
  event_request_equipment: EquipmentRow[];
  // SCRUM-81
  registration_required: boolean | null;
  // SCRUM-92. All three are null together or set together
  // (event_request_decision_complete).
  decision: Decision | null;
  decided_by: string | null;
  decided_at: string | null;
  // SCRUM-93. Set exactly when decision = 'rejected'
  // (event_request_rejection_reason_matches_decision).
  rejection_reason: string | null;
  // SCRUM-94. All three are null together or set together
  // (event_request_assignment_complete).
  coordinator_id: string | null;
  assigned_by: string | null;
  assigned_at: string | null;
  // SCRUM-90. All three are null together or set together
  // (event_request_clarification_complete).
  clarification_note: string | null;
  clarification_requested_by: string | null;
  clarification_requested_at: string | null;
}

export interface EventRequestWrite {
  name: string;
  purpose: string | null;
  description: string | null;
  proposed_date: string | null;
  // SCRUM-77. Always written as null since SCRUM-238: a request has times, not
  // slots. Clearing it on save means an edited legacy request keeps no stale
  // slot behind its new times (the fill trigger ignores a null array).
  time_slots: null;
  // SCRUM-238. `HH:MM`; both null or both set (event_request_times_together).
  start_time: string | null;
  end_time: string | null;
  // SCRUM-78's column. Optional on the write so SCRUM-76's create path, which
  // does not collect it, keeps compiling unchanged; SCRUM-83's draft save does
  // send it. See the note in domain/event-request/service.ts about the create
  // path still dropping this value.
  expected_attendance?: number | null;
  // SCRUM-79. Null until the organiser has chosen one.
  room_layout: string | null;
  // SCRUM-79. Null until answered; notes only ever alongside `true`.
  accessibility_required: boolean | null;
  accessibility_notes: string | null;
  // SCRUM-79. Null is "no preference"; the foreign key refuses an unknown id.
  preferred_location_id: string | null;
  // SCRUM-80. Null until answered; notes are independent of the answer (AC2).
  equipment_required: boolean | null;
  technical_support_notes: string | null;
  // SCRUM-81. Null until answered. Written on every save, so unmarking clears it (AC3).
  registration_required: boolean | null;
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
// SCRUM-79 — State venue and accessibility requirements
// ---------------------------------------------------------------------------

/**
 * AC2 — the chosen features, one link row each. The list sent replaces the
 * whole list: the service deletes first, then inserts. The foreign key is what
 * refuses an id that is not on the maintained list.
 */
export async function insertEventRequestAccessibilityFeatures(
  supabase: SupabaseClient,
  eventRequestId: string,
  featureIds: string[],
) {
  if (featureIds.length === 0) return { error: null };
  return supabase.from('event_request_accessibility_features').insert(
    featureIds.map((accessibility_feature_id) => ({
      event_request_id: eventRequestId,
      accessibility_feature_id,
    })),
  );
}

export async function deleteEventRequestAccessibilityFeatures(
  supabase: SupabaseClient,
  eventRequestId: string,
) {
  return supabase
    .from('event_request_accessibility_features')
    .delete()
    .eq('event_request_id', eventRequestId);
}

// ---------------------------------------------------------------------------
// SCRUM-80 — State equipment and technical support requirements
// ---------------------------------------------------------------------------

/**
 * AC1 — one row per item, in the order listed. Like the accessibility links,
 * the list sent replaces the whole list: delete, then insert.
 */
export async function insertEventRequestEquipment(
  supabase: SupabaseClient,
  eventRequestId: string,
  items: { item: string; quantity: number }[],
) {
  if (items.length === 0) return { error: null };
  return supabase.from('event_request_equipment').insert(
    items.map((entry, position) => ({
      event_request_id: eventRequestId,
      position,
      item: entry.item,
      quantity: entry.quantity,
    })),
  );
}

export async function deleteEventRequestEquipment(supabase: SupabaseClient, eventRequestId: string) {
  return supabase.from('event_request_equipment').delete().eq('event_request_id', eventRequestId);
}

// ---------------------------------------------------------------------------
// SCRUM-82 — Submit a completed event request
// ---------------------------------------------------------------------------

/**
 * AC1 — flips a draft to submitted; submitted_at is stamped by the database.
 * The `status` filter is what makes submitting twice impossible: a second
 * concurrent call matches no row and comes back empty rather than quietly
 * overwriting the first.
 *
 * SCRUM-90 AC2 — `clarification_requested` is still accepted here even though
 * canBeSubmitted() (domain/event-request/policy.ts) no longer allows it as of
 * the 2026-09-22 bug fix: the real app never reaches this function for that
 * status any more, since submitEventRequest() refuses it first. This filter is
 * left wider on purpose so it keeps working as a direct write for whoever
 * still calls it that way (e.g. tests/integration/review-detail-clarification.test.ts,
 * which exercises this filter directly rather than the policy layer above it)
 * and for SCRUM-91's own resubmission path, which writes status via its own
 * database trigger and never calls this function at all. Note set_submitted_at
 * only stamps on draft -> submitted, so a resubmission through here keeps its
 * original submission time and therefore its place in the coordinator's queue
 * rather than going to the back of it.
 */
export async function markEventRequestSubmitted(supabase: SupabaseClient, id: string) {
  return supabase
    .from('event_request')
    .update({ status: 'submitted' })
    .eq('id', id)
    .in('status', ['draft', 'clarification_requested'])
    .select(COLUMNS)
    .maybeSingle();
}

// ---------------------------------------------------------------------------
// SCRUM-92 — Approve a request so planning can proceed
// ---------------------------------------------------------------------------
// Per docs/architecture.md (rule 3), both the Supabase client and the query
// live here, so domain/review/service.ts never holds a client. The SCRUM-82
// functions above predate that wording and still take the client as a
// parameter; they are left as they are rather than refactored from this story.

/** createAdminClient memoises its client, so calling it per query is free. */
function db(): SupabaseClient {
  return createAdminClient();
}

/** AC1 and AC2 — one request by id, including its decision columns. */
export async function fetchEventRequestById(id: string) {
  return db().from('event_request').select(COLUMNS).eq('id', id).maybeSingle();
}

/**
 * AC1 — flips a submitted request to approved and records the decision and who
 * made it in the same statement. decided_at is stamped by the database (see
 * set_decided_at), so the caller cannot choose the time.
 *
 * The `status` filter is the guard: a request that is not submitted matches no
 * row and comes back empty, which is also what stops two coordinators
 * approving the same request at once. Same shape as
 * markEventRequestSubmitted above.
 */
export async function markEventRequestApproved(id: string, actorId: string) {
  return db()
    .from('event_request')
    .update({ status: 'approved', decision: 'approved', decided_by: actorId })
    .eq('id', id)
    .eq('status', 'submitted')
    // SCRUM-213 — the same rule as canReviewDetail, applied inside the UPDATE.
    // The service checks it first, but an Event Operations Manager can reassign
    // the event between that check and this write; the filter is what makes the
    // decision impossible rather than merely unlikely, the same pattern as
    // assignCoordinatorToEventRequest (SCRUM-94).
    //
    // SCRUM-232 AC5 (Week 7 Change 5): no `is.null` branch here any more - an
    // event with no coordinator yet can no longer be approved by anyone,
    // superseding the earlier reading on approveEventRequest's own comment.
    .eq('coordinator_id', actorId)
    .select(COLUMNS)
    .maybeSingle();
}

// ---------------------------------------------------------------------------
// SCRUM-93 — Reject a request
// ---------------------------------------------------------------------------

/**
 * AC4 — flips a submitted request to rejected and records the decision, the
 * reason and who made it in the same statement. decided_at is stamped by the
 * database (set_decided_at), same as approval - the trigger fires on any
 * write to decision, 'rejected' included.
 *
 * The `status` filter is the guard, same shape as markEventRequestApproved: a
 * request that is not submitted matches no row and comes back empty, which is
 * also what stops two coordinators deciding the same request at once.
 */
export async function markEventRequestRejected(id: string, reason: string, actorId: string) {
  return db()
    .from('event_request')
    .update({ status: 'rejected', decision: 'rejected', decided_by: actorId, rejection_reason: reason })
    .eq('id', id)
    .eq('status', 'submitted')
    // SCRUM-96 AC4 — the same rule as canReviewDetail, applied inside the
    // UPDATE, the pattern SCRUM-213 set on markEventRequestApproved above: an
    // Event Operations Manager can reassign the event between the service's
    // check and this write, and the filter makes the UPDATE miss rather than
    // record a decision by a coordinator it was taken away from.
    //
    // SCRUM-232 AC5: no `is.null` branch - an event with no coordinator yet
    // can no longer be rejected by anyone.
    .eq('coordinator_id', actorId)
    .select(COLUMNS)
    .maybeSingle();
}

/**
 * AC3 — an organiser's own requests, newest first.
 *
 * SCRUM-204 AC3 — plus, when the organiser belongs to a client organisation,
 * every non-draft request from a colleague in that same organisation (the
 * "not listed" half of canViewRequest() in domain/event-request/policy.ts —
 * a colleague's still-private draft never appears here). A rejected request
 * is not draft, so it is shared the same as any other decided request.
 */
export async function listEventRequestsForOrganiser(
  supabase: SupabaseClient,
  organiserId: string,
  clientOrganisationId: string | null,
) {
  const query = supabase.from('event_request').select(COLUMNS);
  const filtered = clientOrganisationId
    ? query.or(
        `organiser_id.eq.${organiserId},and(client_organisation_id.eq.${clientOrganisationId},status.neq.draft)`,
      )
    : query.eq('organiser_id', organiserId);
  return filtered.order('created_at', { ascending: false });
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
/**
 * SCRUM-95 AC1 — submitted events with no coordinator yet: the pool an
 * Operations Manager still needs to act on. Same predicate as
 * canBeAssigned() in domain/assignment/policy.ts, checked at the database
 * instead of read into memory to filter, since every submitted event's
 * coordinator_id is already indexed (event_request_coordinator_id_idx).
 */
export async function listUnassignedSubmittedEventRequests() {
  return db()
    .from('event_request')
    .select(COLUMNS)
    .eq('status', 'submitted')
    .is('coordinator_id', null)
    .order('submitted_at', { ascending: true });
}
// ---------------------------------------------------------------------------
// SCRUM-94 — Assign an Event Coordinator to a submitted event
// ---------------------------------------------------------------------------
// Same arrangement as SCRUM-92 above: the client and the query both live here
// so domain/assignment/service.ts never holds one (docs/architecture.md rule 3).

/**
 * AC1 — puts a coordinator on a submitted event and records who assigned them
 * in the same statement. assigned_at is stamped by the database (see
 * set_assigned_at), so the caller cannot choose the time.
 *
 * The two filters are the guard, and they are what makes AC5 true: an event
 * that is no longer submitted, or that someone else has already been put on,
 * matches no row and comes back empty. Two managers assigning at the same
 * moment therefore produce exactly one assignment, decided by Postgres rather
 * than by whichever request happened to read first.
 */
export async function assignCoordinatorToEventRequest(
  id: string,
  coordinatorId: string,
  assignedBy: string,
) {
  return db()
    .from('event_request')
    .update({ coordinator_id: coordinatorId, assigned_by: assignedBy })
    .eq('id', id)
    .eq('status', 'submitted')
    .is('coordinator_id', null)
    .select(COLUMNS)
    .maybeSingle();
}

/** AC3 — the events one coordinator owns, oldest submission first. */
export async function listEventRequestsForCoordinator(coordinatorId: string) {
  return db()
    .from('event_request')
    .select(COLUMNS)
    .eq('coordinator_id', coordinatorId)
    .order('submitted_at', { ascending: true });
}

// ---------------------------------------------------------------------------
// SCRUM-90 — Request clarification from the Event Organiser
// ---------------------------------------------------------------------------

/**
 * AC1 — flips a submitted request to clarification_requested and records the
 * note and who asked in the same statement. clarification_requested_at is
 * stamped by the database (see set_clarification_requested_at), same reason
 * as decided_at.
 *
 * The `status` filter is the guard, same shape as markEventRequestApproved: a
 * request that is not submitted matches no row and comes back empty rather
 * than silently overwriting an existing note or clarifying a draft.
 */
export async function markEventRequestClarificationRequested(
  id: string,
  note: string,
  actorId: string,
) {
  return db()
    .from('event_request')
    .update({
      status: 'clarification_requested',
      clarification_note: note,
      clarification_requested_by: actorId,
    })
    .eq('id', id)
    .eq('status', 'submitted')
    // The same rule as canReviewDetail, applied inside the UPDATE - the
    // pattern SCRUM-213 set on markEventRequestApproved above, for the same
    // reason: the service checks it first, but an Event Operations Manager
    // can reassign the event between that check and this write. The filter
    // asks whether this actor may act on the row *now*, not whether the row
    // is unchanged since it was read - so a request assigned to the actor
    // mid-request still goes through, and one reassigned away from them
    // does not.
    //
    // SCRUM-232 AC5: no `is.null` branch - an event with no coordinator yet
    // can no longer be clarified by anyone.
    .eq('coordinator_id', actorId)
    .select(COLUMNS)
    .maybeSingle();
}

// ---------------------------------------------------------------------------
// SCRUM-101 AC3 — Approved -> Planning
// ---------------------------------------------------------------------------

/**
 * AC3 — flips an approved event to planning. No decision fields to record:
 * unlike approve/reject, this is not a human decision, it is a consequence of
 * another action (a venue booking request being raised), so there is no actor
 * to stamp.
 *
 * The `status` filter is the guard, same shape as markEventRequestApproved:
 * a row that is not approved matches nothing and comes back empty. AC4's
 * idempotent case (already planning) is deliberately not matched here either
 * - src/domain/event-status/service.ts's enterPlanning() checks for that
 * itself and treats it as success without writing, rather than this
 * function silently writing a row that already has the value.
 */
export async function markEventRequestPlanning(id: string) {
  return db()
    .from('event_request')
    .update({ status: 'planning' })
    .eq('id', id)
    .eq('status', 'approved')
    .select(COLUMNS)
    .maybeSingle();
}

// ---------------------------------------------------------------------------
// SCRUM-103 — Prevent invalid status transitions
// ---------------------------------------------------------------------------

/**
 * Moves an event from `from` to `to`, and only if it is still in `from`.
 *
 * The `status` filter is the guard, the same shape as markEventRequestApproved:
 * if something else changed the status after the service read it, no row
 * matches and this comes back empty, so a move checked against the old status
 * is never applied to a new one. Whether `from -> to` is allowed at all is
 * decided before this is called, in domain/event-status/policy.ts.
 */
export async function markEventRequestStatus(id: string, from: EventRequestStatus, to: EventRequestStatus) {
  return db()
    .from('event_request')
    .update({ status: to })
    .eq('id', id)
    .eq('status', from)
    .select('id, status')
    .maybeSingle();
}
