import {
  EventRequestIdSchema,
  RegistrationInputSchema,
  RegistrationStatusSchema,
  type EventVenue,
  type MyRegistration,
  type OpenEvent,
  type Registration,
  type RegistrationPageView,
  type RegistrationPeriod,
} from './schema';
import {
  ALREADY_REGISTERED,
  FINAL_EVENT_REFUSALS,
  NO_PLACES_REMAINING,
  bookedVenues,
  endedMessage,
  eventTimes,
  finalEventStatus,
  isEventCancelled,
  isEventFull,
  isOpenForRegistration,
  notStartedMessage,
  registrationPeriodRefusal,
} from './policy';
import { todayInSingapore } from '@/domain/shared/dates';
import { CapacityExceededError, ConflictError, NotFoundError, ValidationError } from '@/domain/shared/errors';
import {
  countRegisteredRegistrations,
  createRegistrationRow,
  fetchMyRegistrations,
  fetchOpenEvents,
  fetchRegisteredRegistration,
  fetchRegistrationEvent,
} from '@/lib/supabase/eventRegistrations';

/**
 * SCRUM-181 — Register for an event.
 *
 * `now` is a parameter so tests can fix the clock; callers leave it out.
 * "Today" is always the Singapore date (AC4).
 */

/** The event as ATTENDEE_EVENT_COLUMNS reads it, with the venues of its bookings, and its status. */
type EventRow = {
  id: string;
  name: string;
  status: string;
  description: string | null;
  proposed_date: string | null;
  start_time: string | null;
  end_time: string | null;
  registration_start_date: string | null;
  registration_end_date: string | null;
  registration_capacity: number | null;
  venue_booking: { status: string; venue_id: string; venues: EventVenue | null }[];
};

type RegistrationRow = {
  id: string;
  reference: string;
  event_request_id: string;
  full_name: string;
  email: string;
  contact_number: string;
  status: string;
  registered_at: string;
};

function toRegistration(row: RegistrationRow): Registration {
  return {
    id: row.id,
    reference: row.reference,
    eventRequestId: row.event_request_id,
    fullName: row.full_name,
    email: row.email,
    contactNumber: row.contact_number,
    status: RegistrationStatusSchema.parse(row.status),
    registeredAt: row.registered_at,
  };
}

/**
 * The event and its registration period. An event with no period set takes no
 * registrations, so to an attendee it is not found, the same as an unknown id:
 * nothing about an event is shown until the coordinator opens registration.
 */
async function readEvent(eventRequestId: string): Promise<{ event: EventRow; period: RegistrationPeriod }> {
  if (!EventRequestIdSchema.safeParse(eventRequestId).success) throw new NotFoundError('Event');
  const { data, error } = await fetchRegistrationEvent(eventRequestId);
  if (error) throw new ValidationError('The event could not be read.', error.message);
  const event = data as unknown as EventRow | null;
  if (!event || !event.registration_start_date || !event.registration_end_date) throw new NotFoundError('Event');
  return {
    event,
    period: { startDate: event.registration_start_date, endDate: event.registration_end_date },
  };
}

async function readRegistration(eventRequestId: string, attendeeId: string): Promise<Registration | null> {
  const { data, error } = await fetchRegisteredRegistration(eventRequestId, attendeeId);
  if (error) throw new ValidationError('Your registration could not be read.', error.message);
  return data ? toRegistration(data as RegistrationRow) : null;
}

/** SCRUM-182 AC1: whether the event's capacity is reached (or not set). */
async function readFull(event: EventRow): Promise<boolean> {
  const { count, error } = await countRegisteredRegistrations(event.id);
  if (error) throw new ValidationError('The places remaining could not be read.', error.message);
  return isEventFull(event.registration_capacity, count ?? 0);
}

function alreadyRegistered(registration: Registration | null): ConflictError {
  return new ConflictError(ALREADY_REGISTERED, { registration });
}

/**
 * The Attendee's page for one event: its name and date, the registration
 * period, whether it is open today (AC2, AC3, AC4), whether it is full
 * (SCRUM-182 AC1), and the viewer's own registration if they have one (AC5).
 * SCRUM-180 AC3: also the description, the start and end times, and each
 * venue's name and address. SCRUM-270: also whether the event is Cancelled or
 * Completed, so the page shows that instead of the form.
 */
export async function getRegistrationPage(
  eventRequestId: string,
  attendeeId: string,
  now: Date = new Date(),
): Promise<RegistrationPageView> {
  const { event, period } = await readEvent(eventRequestId);
  return {
    eventRequestId: event.id,
    eventName: event.name,
    description: event.description,
    eventDate: event.proposed_date,
    times: eventTimes(event.start_time, event.end_time),
    venues: bookedVenues(event.venue_booking),
    period,
    periodRefusal: registrationPeriodRefusal(period, todayInSingapore(now)),
    full: await readFull(event),
    finalStatus: finalEventStatus(event.status),
    registration: await readRegistration(eventRequestId, attendeeId),
  };
}

function toOpenEvent(row: EventRow): OpenEvent {
  return {
    eventRequestId: row.id,
    eventName: row.name,
    eventDate: row.proposed_date,
    times: eventTimes(row.start_time, row.end_time),
    venues: bookedVenues(row.venue_booking),
  };
}

/**
 * SCRUM-180 AC1, AC2 — the events open for registration today (Singapore
 * date), soonest first, leaving out a Cancelled or Completed event. The query
 * already filters by the period and the status; the same rule is applied again
 * here so the list and the event page's form agree on every boundary, whatever
 * the query does.
 */
export async function listOpenEvents(now: Date = new Date()): Promise<OpenEvent[]> {
  const today = todayInSingapore(now);
  const { data, error } = await fetchOpenEvents(today);
  if (error) throw new ValidationError('The events open for registration could not be read.', error.message);
  return ((data ?? []) as unknown as EventRow[])
    .filter((row) =>
      isOpenForRegistration(
        { startDate: row.registration_start_date, endDate: row.registration_end_date },
        row.status,
        today,
      ),
    )
    .map(toOpenEvent);
}

type MyRegistrationRow = {
  id: string;
  reference: string;
  status: string;
  event_request: EventRow;
};

/**
 * SCRUM-180 AC4 — the signed-in attendee's registrations, each with its
 * event's name, date, times and venue and the registration's status, soonest
 * event first. `attendeeId` is whoever is signed in, from the page, never from
 * a request, so only their own registrations are read. AC6: a cancelled
 * event's registration is still listed, marked as cancelled.
 */
export async function listMyRegistrations(attendeeId: string): Promise<MyRegistration[]> {
  const { data, error } = await fetchMyRegistrations(attendeeId);
  if (error) throw new ValidationError('Your registrations could not be read.', error.message);
  return ((data ?? []) as unknown as MyRegistrationRow[])
    .map((row) => ({
      ...toOpenEvent(row.event_request),
      registrationId: row.id,
      reference: row.reference,
      status: RegistrationStatusSchema.parse(row.status),
      eventCancelled: isEventCancelled(row.event_request.status),
    }))
    .sort(bySoonestEvent);
}

/** Soonest event first; an event with no date yet last; then by name. */
function bySoonestEvent(a: OpenEvent, b: OpenEvent): number {
  if (a.eventDate !== b.eventDate) {
    if (!a.eventDate) return 1;
    if (!b.eventDate) return -1;
    return a.eventDate < b.eventDate ? -1 : 1;
  }
  return a.eventName.localeCompare(b.eventName);
}

/**
 * AC1: register the signed-in attendee for the event, with the full name,
 * email address and contact number they typed. Returns the new registration,
 * which the page shows as the confirmation.
 *
 * Checked in this order:
 *   - AC5 first: someone already registered is shown their registration, even
 *     once the period has closed, rather than told it is closed;
 *   - then whether the event is Cancelled or Completed (SCRUM-270), before the
 *     period, since neither takes registrations whatever the period says;
 *   - then the period (AC2, AC3, AC4) and whether the event is full
 *     (SCRUM-182 AC1), before the fields, so a form that could never be
 *     accepted is not picked apart field by field;
 *   - then the fields (AC1).
 * The database function checks the period, the duplicate and places remaining
 * again with the event row locked, so two registrations sent at the same
 * moment still make only one (TC-181-15), and two attendees going for the last
 * place get one place between them (SCRUM-182 AC2).
 *
 * No limit on how many events one attendee joins (AC6): nothing here looks at
 * the attendee's other registrations.
 *
 * `attendeeId` is whoever is signed in, from the route, never from the body.
 */
export async function registerForEvent(
  eventRequestId: string,
  attendeeId: string,
  input: unknown,
  now: Date = new Date(),
): Promise<Registration> {
  const { event, period } = await readEvent(eventRequestId);

  const existing = await readRegistration(eventRequestId, attendeeId);
  if (existing) throw alreadyRegistered(existing);

  const finalStatus = finalEventStatus(event.status);
  if (finalStatus) throw new ValidationError(FINAL_EVENT_REFUSALS[finalStatus], { eventStatus: finalStatus });

  const today = todayInSingapore(now);
  const refusal = registrationPeriodRefusal(period, today);
  if (refusal) throw new ValidationError(refusal, period);

  if (await readFull(event)) throw new CapacityExceededError(NO_PLACES_REMAINING);

  const parsed = RegistrationInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('Your registration is not complete.', parsed.error.flatten());
  }

  const { data: outcome, error } = await createRegistrationRow(eventRequestId, attendeeId, parsed.data, today);
  if (error) throw new ValidationError('Your registration could not be saved.', error.message);

  switch (outcome) {
    case 'registered': {
      const registration = await readRegistration(eventRequestId, attendeeId);
      if (!registration) throw new ValidationError('Your registration could not be read back.');
      return registration;
    }
    case 'already_registered':
      // Another request registered this attendee after the read above.
      throw alreadyRegistered(await readRegistration(eventRequestId, attendeeId));
    case 'not_started':
      throw new ValidationError(notStartedMessage(period), period);
    case 'ended':
      throw new ValidationError(endedMessage(period), period);
    case 'full':
      // SCRUM-182 AC2: another request took the last place after the read above.
      throw new CapacityExceededError(NO_PLACES_REMAINING);
    case 'cancelled':
    case 'completed':
      // SCRUM-270: the event was cancelled or completed after the read above.
      throw new ValidationError(FINAL_EVENT_REFUSALS[outcome], { eventStatus: outcome });
    default:
      // 'not_found' or 'not_open': the event or its period went after the read above.
      throw new NotFoundError('Event');
  }
}
