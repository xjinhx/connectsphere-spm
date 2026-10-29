import { z } from 'zod';
import type { ISODate } from '@/domain/shared/dates';

/**
 * SCRUM-181 — Register for an event.
 *
 * The registration record is shared: SCRUM-182 (refusing a full event),
 * SCRUM-184 (withdrawing) and SCRUM-185 (the registration list) read and
 * extend these shapes rather than declaring their own.
 */

// Same convention as event-status/schema.ts: each domain validates the id
// shape locally rather than importing another domain's copy.
export const EventRequestIdSchema = z.string().uuid();

/** Registered (AC1); Withdrawn is SCRUM-184's, nothing sets it yet. */
export const RegistrationStatusSchema = z.enum(['registered', 'withdrawn']);
export type RegistrationStatus = z.infer<typeof RegistrationStatusSchema>;

export const REGISTRATION_STATUS_LABELS: Record<RegistrationStatus, string> = {
  registered: 'Registered',
  withdrawn: 'Withdrawn',
};

/**
 * SCRUM-270 — the two event statuses that close registration for good: the
 * event is not going ahead, whatever its registration period says.
 */
export type FinalEventStatus = 'cancelled' | 'completed';

export const FINAL_EVENT_STATUS_LABELS: Record<FinalEventStatus, string> = {
  cancelled: 'Cancelled',
  completed: 'Completed',
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
 * internal planning fields (SCRUM-72 AC1).
 */
export interface RegistrationPageView {
  eventRequestId: string;
  eventName: string;
  eventDate: ISODate | null;
  period: RegistrationPeriod;
  /** Why registering is refused today (AC2, AC3), or null when it is open. */
  periodRefusal: string | null;
  /** SCRUM-182 AC1: the capacity is reached (or not set), so the event is shown as full. */
  full: boolean;
  /** SCRUM-270: the event is Cancelled or Completed, so it takes no registrations; null while it is going ahead. */
  finalStatus: FinalEventStatus | null;
  /** The viewer's Registered registration for this event, if any (AC5). */
  registration: Registration | null;
}
