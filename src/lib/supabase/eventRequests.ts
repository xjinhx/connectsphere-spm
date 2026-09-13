import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase access for event requests. Thin by design: the query lives here, the
 * decision about whether to run it lives in domain/event-request/service.ts.
 */

const COLUMNS =
  'id, reference, organiser_id, client_organisation_id, name, purpose, description, proposed_date, ' +
  'time_slots, expected_attendance, status, submitted_at, created_at, updated_at, ' +
  // SCRUM-79. The chosen accessibility features come back nested through the
  // link table, the same way a venue's do in lib/supabase/venues.ts.
  'room_layout, accessibility_required, accessibility_notes, ' +
  'event_request_accessibility_features ( accessibility_features ( id, name ) ), ' +
  'preferred_location:locations ( id, name ), ' +
  // SCRUM-80
  'equipment_required, technical_support_notes, ' +
  'event_request_equipment ( position, item, quantity ), ' +
  // SCRUM-81
  'registration_required';

export interface ReferenceRow {
  id: string;
  name: string;
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
  expected_attendance: number | null;
  // SCRUM-82
  status: 'draft' | 'submitted';
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
  // SCRUM-80
  equipment_required: boolean | null;
  technical_support_notes: string | null;
  event_request_equipment: EquipmentRow[];
  // SCRUM-81
  registration_required: boolean | null;
}

export interface EquipmentRow {
  position: number;
  item: string;
  quantity: number;
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