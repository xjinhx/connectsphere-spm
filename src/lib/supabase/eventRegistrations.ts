import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './admin';
import type { Database } from './database.types';

/**
 * Event registration queries (SCRUM-181 Register for an event). The query
 * lives here; whether to run it is decided in
 * src/domain/event-registration/service.ts. Each returns the raw Supabase
 * result; error mapping is the service's job.
 */

function db(): SupabaseClient<Database> {
  return createAdminClient();
}

export const REGISTRATION_COLUMNS =
  'id, reference, event_request_id, full_name, email, contact_number, status, registered_at';

/**
 * What the Attendee's page needs from the event: its name and date, the
 * registration period and its capacity (SCRUM-182). Nothing else, so no
 * internal planning field can reach an attendee (SCRUM-72 AC1). maybeSingle:
 * an unknown id is null, not an error.
 */
export async function fetchRegistrationEvent(eventRequestId: string) {
  return db()
    .from('event_request')
    .select('id, name, proposed_date, registration_start_date, registration_end_date, registration_capacity')
    .eq('id', eventRequestId)
    .maybeSingle();
}

/** SCRUM-182 AC1: how many places the event's Registered registrations take. */
export async function countRegisteredRegistrations(eventRequestId: string) {
  return db()
    .from('event_registration')
    .select('id', { count: 'exact', head: true })
    .eq('event_request_id', eventRequestId)
    .eq('status', 'registered');
}

/** AC5: the attendee's Registered registration for this event, or null. */
export async function fetchRegisteredRegistration(eventRequestId: string, attendeeId: string) {
  return db()
    .from('event_registration')
    .select(REGISTRATION_COLUMNS)
    .eq('event_request_id', eventRequestId)
    .eq('attendee_id', attendeeId)
    .eq('status', 'registered')
    .maybeSingle();
}

/**
 * SCRUM-184 AC1: one registration by its id, with whose it is, whatever its
 * status, so the service can tell someone else's (not found) from one already
 * withdrawn. maybeSingle: an unknown id is null, not an error.
 */
export async function fetchRegistrationById(registrationId: string) {
  return db()
    .from('event_registration')
    .select(`${REGISTRATION_COLUMNS}, attendee_id`)
    .eq('id', registrationId)
    .maybeSingle();
}

/**
 * SCRUM-184 AC1: set the attendee's registration to Withdrawn. One statement,
 * guarded on the status, so two withdrawals sent together change it once: the
 * second finds no Registered row and returns null (TC-184-03). The row is
 * kept, never deleted (AC2).
 */
export async function withdrawRegistrationRow(registrationId: string, attendeeId: string) {
  return db()
    .from('event_registration')
    .update({ status: 'withdrawn' })
    .eq('id', registrationId)
    .eq('attendee_id', attendeeId)
    .eq('status', 'registered')
    .select(REGISTRATION_COLUMNS)
    .maybeSingle();
}

/**
 * AC1: create the registration. The function re-checks the period, the
 * duplicate and places remaining with the event row locked, and returns
 * 'registered', 'not_found', 'not_open', 'not_started', 'ended', 'full' or
 * 'already_registered'.
 */
export async function createRegistrationRow(
  eventRequestId: string,
  attendeeId: string,
  details: { fullName: string; email: string; contactNumber: string },
  today: string,
) {
  return db().rpc('register_for_event', {
    p_event_request_id: eventRequestId,
    p_attendee_id: attendeeId,
    p_full_name: details.fullName,
    p_email: details.email,
    p_contact_number: details.contactNumber,
    p_today: today,
  });
}
