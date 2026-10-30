import {
  EventRequestIdSchema,
  RegistrationIdSchema,
  RegistrationInputSchema,
  RegistrationStatusSchema,
  type MyRegistration,
  type Registration,
  type RegistrationPageView,
  type RegistrationPeriod,
} from './schema';
import {
  ALREADY_REGISTERED,
  ALREADY_WITHDRAWN,
  EVENT_TAKEN_PLACE,
  NO_PLACES_REMAINING,
  canWithdraw,
  endedMessage,
  isEventFull,
  notStartedMessage,
  registrationPeriodRefusal,
} from './policy';
import { todayInSingapore } from '@/domain/shared/dates';
import {
  CapacityExceededError,
  ConflictError,
  DomainError,
  NotFoundError,
  ValidationError,
} from '@/domain/shared/errors';
import {
  countRegisteredRegistrations,
  createRegistrationRow,
  fetchAttendeeRegistrations,
  fetchRegisteredRegistration,
  fetchRegistrationById,
  fetchRegistrationEvent,
  withdrawRegistrationRow,
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
  registration_capacity: number | null;
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
 * (SCRUM-182 AC1), the viewer's own registration if they have one (AC5), and
 * whether they may still withdraw it (SCRUM-184 AC3).
 */
export async function getRegistrationPage(
  eventRequestId: string,
  attendeeId: string,
  now: Date = new Date(),
): Promise<RegistrationPageView> {
  const { event, period } = await readEvent(eventRequestId);
  const today = todayInSingapore(now);
  const registration = await readRegistration(eventRequestId, attendeeId);
  return {
    eventRequestId: event.id,
    eventName: event.name,
    eventDate: event.proposed_date,
    period,
    periodRefusal: registrationPeriodRefusal(period, today),
    full: await readFull(event),
    registration,
    // SCRUM-184 AC3: no Withdraw action once the event has taken place.
    canWithdraw: registration !== null && canWithdraw(event.proposed_date, today),
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
    default:
      // 'not_found' or 'not_open': the event or its period went after the read above.
      throw new NotFoundError('Event');
  }
}

/**
 * SCRUM-184 AC1: the signed-in attendee withdraws their registration. Its
 * status becomes Withdrawn and the row is kept (AC2). The place returns to the
 * event at once, because only Registered rows count against the capacity
 * (SCRUM-182's event_has_places_remaining); no waiting list in Release 1.
 *
 * Refused with 404 for an unknown registration, one on another event, or
 * another attendee's, so nobody learns whose registrations exist (TC-184-04);
 * with 409 for one already Withdrawn (TC-184-03), or once the event has taken
 * place (AC3, CL-69: from its event date), whatever the page showed.
 *
 * `now` is a parameter so tests can fix the clock; callers leave it out.
 *
 * The confirm step is the page's (TC-184-02): this is only called once the
 * attendee has confirmed. `attendeeId` is whoever is signed in, from the route.
 */
export async function withdrawRegistration(
  eventRequestId: string,
  registrationId: string,
  attendeeId: string,
  now: Date = new Date(),
): Promise<Registration> {
  if (!EventRequestIdSchema.safeParse(eventRequestId).success || !RegistrationIdSchema.safeParse(registrationId).success) {
    throw new NotFoundError('Registration');
  }

  const { data, error } = await fetchRegistrationById(registrationId);
  if (error) throw new ValidationError('Your registration could not be read.', error.message);
  const row = data as (RegistrationRow & { attendee_id: string }) | null;
  if (!row || row.attendee_id !== attendeeId || row.event_request_id !== eventRequestId) {
    throw new NotFoundError('Registration');
  }
  if (row.status !== 'registered') throw new DomainError('INVALID_TRANSITION', ALREADY_WITHDRAWN);

  const { data: event, error: eventError } = await fetchRegistrationEvent(eventRequestId);
  if (eventError) throw new ValidationError('The event could not be read.', eventError.message);
  if (!event) throw new NotFoundError('Registration');
  if (!canWithdraw((event as EventRow).proposed_date, todayInSingapore(now))) {
    throw new DomainError('INVALID_TRANSITION', EVENT_TAKEN_PLACE);
  }

  const { data: withdrawn, error: writeError } = await withdrawRegistrationRow(registrationId, attendeeId);
  if (writeError) throw new ValidationError('Your registration could not be withdrawn.', writeError.message);
  // Another request withdrew it after the read above.
  if (!withdrawn) throw new DomainError('INVALID_TRANSITION', ALREADY_WITHDRAWN);
  return toRegistration(withdrawn as RegistrationRow);
}

/**
 * SCRUM-184 AC2: the signed-in attendee's registrations, Withdrawn ones
 * included rather than removed, newest first. Only their own: the attendee
 * is whoever is signed in, from the page. Withdraw is offered on a Registered
 * one until its event has taken place (AC3).
 */
export async function listMyRegistrations(attendeeId: string, now: Date = new Date()): Promise<MyRegistration[]> {
  const today = todayInSingapore(now);
  const { data, error } = await fetchAttendeeRegistrations(attendeeId);
  if (error) throw new ValidationError('Your registrations could not be read.', error.message);
  const rows = (data ?? []) as (RegistrationRow & {
    event_request: { name: string; proposed_date: string | null } | null;
  })[];
  return rows.map((row) => {
    const registration = toRegistration(row);
    const eventDate = row.event_request?.proposed_date ?? null;
    return {
      registration,
      eventName: row.event_request?.name ?? '',
      eventDate,
      canWithdraw: registration.status === 'registered' && canWithdraw(eventDate, today),
    };
  });
}
