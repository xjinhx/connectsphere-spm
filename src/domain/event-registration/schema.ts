import { z } from 'zod';
import type { ISODate } from '@/domain/shared/dates';
import type { ClockRange } from '@/domain/shared/times';

/**
 * SCRUM-181 — Register for an event.
 *
 * The registration record is shared: SCRUM-182 (refusing a full event),
 * SCRUM-184 (withdrawing) and SCRUM-185 (the registration list) read and
 * extend these shapes rather than declaring their own. SCRUM-180 (browsing
 * open events and my registrations) adds the shapes at the end.
 */

// Same convention as event-status/schema.ts: each domain validates the id
// shape locally rather than importing another domain's copy.
export const EventRequestIdSchema = z.string().uuid();

/** SCRUM-184: the registration being withdrawn, from the route's address. */
export const RegistrationIdSchema = z.string().uuid();

/** Registered (AC1); Withdrawn is set by SCRUM-184's withdrawRegistration. */
export const RegistrationStatusSchema = z.enum(['registered', 'withdrawn']);
export type RegistrationStatus = z.infer<typeof RegistrationStatusSchema>;

export const REGISTRATION_STATUS_LABELS: Record<RegistrationStatus, string> = {
  registered: 'Registered',
  withdrawn: 'Withdrawn',
};

/** A required text field: blank or only spaces counts as missing (TC-181-03). */
function required(message: string) {
  return z.string({ required_error: message, invalid_type_error: message }).trim().min(1, message);
}

/**
 * AC1: "full name, email address and contact number" (customer clarification
 * #22). Every missing field is reported at once, not just the first.
 */
export const RegistrationInputSchema = z.object({
  fullName: required('Enter your full name.'),
  email: required('Enter your email address.').pipe(z.string().email('Enter a valid email address.')),
  contactNumber: required('Enter your contact number.'),
});

export type RegistrationInput = z.infer<typeof RegistrationInputSchema>;

/** The registration period (AC2, AC3, AC4): Singapore dates, both inclusive. */
export interface RegistrationPeriod {
  startDate: ISODate;
  endDate: ISODate;
}

/** One registration, as the confirmation (AC1) and the duplicate refusal (AC5) show it. */
export interface Registration {
  id: string;
  reference: string;
  eventRequestId: string;
  fullName: string;
  email: string;
  contactNumber: string;
  status: RegistrationStatus;
  /** When it was made, an ISO instant. */
  registeredAt: string;
}

/**
 * What the Attendee's event page needs. Only what an attendee may see: no
 * internal planning fields (SCRUM-72 AC1). SCRUM-180 AC3 adds the
 * description, times and venues; `venues` carries each one's address.
 */
export interface RegistrationPageView {
  eventRequestId: string;
  eventName: string;
  description: string | null;
  eventDate: ISODate | null;
  times: ClockRange | null;
  venues: EventVenue[];
  period: RegistrationPeriod;
  /** Why registering is refused today (AC2, AC3), or null when it is open. */
  periodRefusal: string | null;
  /** SCRUM-182 AC1: the capacity is reached (or not set), so the event is shown as full. */
  full: boolean;
  /** The viewer's Registered registration for this event, if any (AC5). */
  registration: Registration | null;
  /** SCRUM-184 AC3: whether the Withdraw action is offered on `registration`. */
  canWithdraw: boolean;
}

/**
 * SCRUM-180 — a venue the event is held at: the venue of each of its confirmed
 * bookings. A released booking's venue is not one (SCRUM-231).
 */
export interface EventVenue {
  name: string;
  /** Null when none is recorded for the venue. */
  address: string | null;
}

/**
 * SCRUM-180 AC1 — one event open for registration, as Open events lists it:
 * name, date, start and end times and venue. The date and times are the
 * event's own, so a reschedule shows wherever they are read.
 */
export interface OpenEvent {
  eventRequestId: string;
  eventName: string;
  eventDate: ISODate | null;
  /** Null until the event has times. */
  times: ClockRange | null;
  venues: EventVenue[];
}

/**
 * SCRUM-180 AC4 — one of the attendee's own registrations, as My
 * registrations lists it: the event's name, date, start and end times and
 * venue, and the registration's status. The event's details are read when the
 * list is, so a reschedule shows (AC5).
 */
export interface MyRegistration extends OpenEvent {
  registrationId: string;
  reference: string;
  status: RegistrationStatus;
  /** AC6: the event was cancelled; the registration stays listed, marked Cancelled. */
  eventCancelled: boolean;
}
