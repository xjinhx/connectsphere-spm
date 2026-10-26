import {
  EventRequestIdSchema,
  RegistrationInputSchema,
  RegistrationStatusSchema,
  type Registration,
  type RegistrationPageView,
  type RegistrationPeriod,
} from './schema';
import {
  ALREADY_REGISTERED,
  NO_PLACES_REMAINING,
  endedMessage,
  notStartedMessage,
  registrationPeriodRefusal,
} from './policy';
import { todayInSingapore } from '@/domain/shared/dates';
import { CapacityExceededError, ConflictError, NotFoundError, ValidationError } from '@/domain/shared/errors';
import {
  createRegistrationRow,
  fetchRegisteredRegistration,
  fetchRegistrationEvent,
} from '@/lib/supabase/eventRegistrations';

/**
 * SCRUM-181 — Register for an event.
 *
 * `now` is a parameter so tests can fix the clock; callers leave it out.
 * "Today" is always the Singapore date (AC4).
 */

type EventRow = {
  id: string;
  name: string;
  proposed_date: string | null;
  registration_start_date: string | null;
  registration_end_date: string | null;
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
  const event = data as EventRow | null;
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

function alreadyRegistered(registration: Registration | null): ConflictError {
  return new ConflictError(ALREADY_REGISTERED, { registration });
}

/**
 * The Attendee's page for one event: its name and date, the registration
 * period, whether it is open today (AC2, AC3, AC4), and the viewer's own
 * registration if they have one (AC5).
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
    eventDate: event.proposed_date,
    period,
    periodRefusal: registrationPeriodRefusal(period, todayInSingapore(now)),
    registration: await readRegistration(eventRequestId, attendeeId),
  };
}

/**
 * AC1: register the signed-in attendee for the event, with the full name,
 * email address and contact number they typed. Returns the new registration,
 * which the page shows as the confirmation.
 *
 * Checked in this order:
 *   - AC5 first: someone already registered is shown their registration, even
 *     once the period has closed, rather than told it is closed;
 *   - then the period (AC2, AC3, AC4), before the fields, so a form that could
 *     never be accepted is not picked apart field by field;
 *   - then the fields (AC1).
 * The database function checks the period, the duplicate and places remaining
 * again with the event row locked, so two registrations sent at the same
 * moment still make only one (TC-181-15).
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
  const { period } = await readEvent(eventRequestId);

  const existing = await readRegistration(eventRequestId, attendeeId);
  if (existing) throw alreadyRegistered(existing);

  const today = todayInSingapore(now);
  const refusal = registrationPeriodRefusal(period, today);
  if (refusal) throw new ValidationError(refusal, period);

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
      throw new CapacityExceededError(NO_PLACES_REMAINING);
    default:
      // 'not_found' or 'not_open': the event or its period went after the read above.
      throw new NotFoundError('Event');
  }
}
