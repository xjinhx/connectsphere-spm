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
 * SCRUM-180: each of the event's bookings with its venue's name and address.
 * The service keeps the confirmed ones (bookedVenues).
 */
const BOOKED_VENUES = 'venue_booking (status, venues (name, address))';

/**
 * SCRUM-180 AC3: what an attendee may see of one event, and nothing else: the
 * name, description, date, start and end times, the venues' names and
 * addresses, and the registration period. No client organisation, internal
 * comment, booking status shown, equipment, staff or other attendees, so none
 * can reach an attendee (SCRUM-72 AC1). Shared by the list and the page.
 */
export const ATTENDEE_EVENT_COLUMNS =
  `id, name, description, proposed_date, start_time, end_time, registration_start_date, registration_end_date, ${BOOKED_VENUES}`;

/**
 * What the Attendee's page needs from the event (SCRUM-181, and SCRUM-180
 * AC3). maybeSingle: an unknown id is null, not an error.
 */
export async function fetchRegistrationEvent(eventRequestId: string) {
  return db().from('event_request').select(ATTENDEE_EVENT_COLUMNS).eq('id', eventRequestId).maybeSingle();
}

/**
 * SCRUM-180 AC1, AC2: the events whose registration period includes `today`
 * (a Singapore date; both ends inclusive), soonest first. The same attendee
 * columns as the page, so nothing internal reaches an attendee (SCRUM-72
 * AC1). An event with no period never matches.
 */
export async function fetchOpenEvents(today: string) {
  return db()
    .from('event_request')
    .select(ATTENDEE_EVENT_COLUMNS)
    .lte('registration_start_date', today)
    .gte('registration_end_date', today)
    .order('proposed_date', { ascending: true })
    .order('name', { ascending: true });
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
