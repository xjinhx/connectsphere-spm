import { z } from 'zod';
import { hasLongYear, isISODate, LATEST_DATE, type ISODate } from '@/domain/shared/dates';

/**
 * SCRUM-185 — View the registration list for an event.
 *
 * AC5, AC6: the assigned coordinator of a Confirmed event sets the
 * registration start date, end date and capacity. They are stored in the
 * columns SCRUM-181 added to event_request
 * (20261024130843_event_registration.sql), which 181 reads to open and close
 * registration, so nothing here adds columns of its own (PO, 26 Oct 2026).
 * Dates, not times, both inclusive (CL-59).
 */

export const REGISTRATION_SETTINGS_FIELDS = ['startDate', 'endDate', 'capacity'] as const;
export type RegistrationSettingsField = (typeof REGISTRATION_SETTINGS_FIELDS)[number];

export const REGISTRATION_SETTINGS_LABELS: Record<RegistrationSettingsField, string> = {
  startDate: 'Registration start date',
  endDate: 'Registration end date',
  capacity: 'Capacity',
};

export const START_DATE_MESSAGE = 'Enter the registration start date.';
export const END_DATE_MESSAGE = 'Enter the registration end date.';
export const END_BEFORE_START_MESSAGE = 'Registration end date must be on or after the start date.';
export const CAPACITY_MESSAGE = 'Capacity must be a whole number of at least 1.';

/** A date input's value: a real date with a four-digit year (a browser lets you type 20266). */
const dateField = (message: string) =>
  z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : value),
    z
      .string({ required_error: message, invalid_type_error: message })
      // Blank fails here too, so a missing date gets the one message.
      .refine((value) => !hasLongYear(value) && isISODate(value) && value <= LATEST_DATE, message),
  );

/** The form sends text; the API may send a number. Either way a whole number of at least 1. */
const capacityField = z.preprocess(
  (value) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed === '' ? undefined : /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
    }
    return value;
  },
  z
    .number({ required_error: CAPACITY_MESSAGE, invalid_type_error: CAPACITY_MESSAGE })
    .int(CAPACITY_MESSAGE)
    .min(1, CAPACITY_MESSAGE)
    // Postgres integer; anything bigger is past every venue anyway.
    .max(2_147_483_647, CAPACITY_MESSAGE),
);

/**
 * AC5, AC6: all three together. AC6's first rule (end before start) is here,
 * reported against the end date; its second (capacity above the venues) needs
 * the event's venues, so it is in the service.
 */
export const RegistrationSettingsInputSchema = z
  .object({
    startDate: dateField(START_DATE_MESSAGE),
    endDate: dateField(END_DATE_MESSAGE),
    capacity: capacityField,
  })
  .superRefine((value, ctx) => {
    // YYYY-MM-DD sorts as text. A one-day period (start = end) is allowed, as
    // in 181's table constraint.
    if (value.endDate < value.startDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: END_BEFORE_START_MESSAGE });
    }
  });

export type RegistrationSettingsInput = z.infer<typeof RegistrationSettingsInputSchema>;

/** What the registration page shows of the settings, and whether it offers the form. */
export interface RegistrationSettingsView {
  eventRequestId: string;
  eventName: string;
  eventReference: string;
  startDate: ISODate | null;
  endDate: ISODate | null;
  capacity: number | null;
  /** AC6: the largest capacity of the event's confirmed venues, or null with none. */
  largestVenueCapacity: number | null;
  /** AC5: the assigned coordinator, while the event is Confirmed. */
  canEdit: boolean;
  /** Why there is no form, or null. */
  readOnlyReason: string | null;
}
