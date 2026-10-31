import { createAdminClient } from './admin';
import { REGISTRATION_COLUMNS } from './eventRegistrations';
import type { EventRequestStatus } from '@/domain/event-request/schema';

/**
 * SCRUM-185 — Supabase access for an event's registration settings. Thin by
 * design: who may read or change them is decided in
 * src/domain/registration-list/service.ts.
 */

const COLUMNS =
  'id, name, reference, status, coordinator_id, registration_start_date, registration_end_date, registration_capacity';

export interface RegistrationSettingsRow {
  id: string;
  name: string;
  reference: string;
  status: EventRequestStatus;
  coordinator_id: string | null;
  registration_start_date: string | null;
  registration_end_date: string | null;
  registration_capacity: number | null;
}

export interface RegistrationSettingsWrite {
  registration_start_date: string;
  registration_end_date: string;
  registration_capacity: number;
}

const db = () => createAdminClient();

export async function fetchRegistrationSettingsRow(eventRequestId: string) {
  return db().from('event_request').select(COLUMNS).eq('id', eventRequestId).maybeSingle();
}

/** AC6: the capacity of each venue the event has a confirmed booking at. */
export async function fetchConfirmedVenueCapacities(eventRequestId: string) {
  return db()
    .from('venue_booking')
    .select('venue:venue_id ( max_capacity )')
    .eq('event_request_id', eventRequestId)
    .eq('status', 'confirmed');
}

/**
 * AC5 — the write, guarded again in the same statement: only while the event
 * is still assigned to `coordinatorId` and Confirmed. A reassignment or a
 * status change between the service's read and this write matches no row
 * (data is null) instead of saving.
 */
export async function updateRegistrationSettingsRow(
  eventRequestId: string,
  coordinatorId: string,
  values: RegistrationSettingsWrite,
) {
  return db()
    .from('event_request')
    .update(values)
    .eq('id', eventRequestId)
    .eq('coordinator_id', coordinatorId)
    .eq('status', 'confirmed')
    .select(COLUMNS)
    .maybeSingle();
}

/** AC1-AC4: what deciding access and heading the list needs from the event. */
export async function fetchRegistrationListEvent(eventRequestId: string) {
  return db()
    .from('event_request')
    .select('id, name, reference, status, coordinator_id, organiser_id, client_organisation_id, registration_capacity')
    .eq('id', eventRequestId)
    .maybeSingle();
}

/** AC1: every registration for the event, oldest first (SCRUM-181's columns). */
export async function fetchEventRegistrations(eventRequestId: string) {
  return db()
    .from('event_registration')
    .select(REGISTRATION_COLUMNS)
    .eq('event_request_id', eventRequestId)
    .order('registered_at', { ascending: true })
    .order('reference', { ascending: true });
}
