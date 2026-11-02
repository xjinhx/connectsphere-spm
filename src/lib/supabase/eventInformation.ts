import { createAdminClient } from './admin';
import type { EventRequestStatus } from '@/domain/event-request/schema';

/**
 * SCRUM-110 — Supabase access for an event's ordinary information. Thin by
 * design: who may read or change it is decided in
 * src/domain/event-information/service.ts.
 *
 * Kept apart from lib/supabase/eventRequests.ts on purpose: internal notes are
 * for internal staff only, and that file's shared select feeds the organiser's
 * pages. Reading them only here keeps them out of every organiser-facing read.
 */

const COLUMNS =
  'id, status, coordinator_id, description, internal_notes, client_contact_name, client_contact_email, client_contact_phone';

export interface EventInformationRow {
  id: string;
  status: EventRequestStatus;
  coordinator_id: string | null;
  description: string | null;
  internal_notes: string | null;
  client_contact_name: string | null;
  client_contact_email: string | null;
  client_contact_phone: string | null;
}

export interface EventInformationWrite {
  description: string;
  internal_notes: string | null;
  client_contact_name: string | null;
  client_contact_email: string | null;
  client_contact_phone: string | null;
}

const db = () => createAdminClient();

export async function fetchEventInformationRow(eventRequestId: string) {
  return db().from('event_request').select(COLUMNS).eq('id', eventRequestId).maybeSingle();
}

/**
 * AC1 / AC5 — the write itself, guarded again in the same statement: only while
 * the event is still assigned to `coordinatorId` and is not Completed or
 * Cancelled. A reassignment or a status change between the service's read and
 * this write therefore matches no row (data is null) instead of saving.
 */
export async function updateEventInformationRow(
  eventRequestId: string,
  coordinatorId: string,
  values: EventInformationWrite,
) {
  return db()
    .from('event_request')
    .update(values)
    .eq('id', eventRequestId)
    .eq('coordinator_id', coordinatorId)
    .not('status', 'in', '(completed,cancelled)')
    .select(COLUMNS)
    .maybeSingle();
}
