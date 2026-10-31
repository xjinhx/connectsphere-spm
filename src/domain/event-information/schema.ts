import { z } from 'zod';
import { eventRequestCoreSchema } from '@/domain/event-request/schema';

/**
 * SCRUM-110 — Edit ordinary event information.
 *
 * AC1 names the five fields the assigned coordinator may edit: description,
 * internal notes, client contact name, client contact email and client contact
 * phone. Anything that would affect an arrangement (date, times, attendance,
 * requirements) is deliberately not here: that is SCRUM-111's flow, which asks
 * for acknowledgement. Nothing in this schema can flag an arrangement.
 */

export const EVENT_INFORMATION_FIELDS = [
  'description',
  'internalNotes',
  'clientContactName',
  'clientContactEmail',
  'clientContactPhone',
] as const;
export type EventInformationField = (typeof EVENT_INFORMATION_FIELDS)[number];

export const EVENT_INFORMATION_LABELS: Record<EventInformationField, string> = {
  description: 'Description',
  internalNotes: 'Internal notes',
  clientContactName: 'Client contact name',
  clientContactEmail: 'Client contact email',
  clientContactPhone: 'Client contact phone',
};

/** Blank and whitespace-only become null, so a cleared field is stored as NULL, never "". */
const blankToNull = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const optionalText = (max: number, label: string) =>
  z.preprocess(blankToNull, z.string().max(max, `${label} must be ${max} characters or fewer`).nullable().default(null));

export const EMAIL_MESSAGE = 'Client contact email must be a valid email address, e.g. name@company.com';
export const PHONE_MESSAGE = 'Client contact phone may contain only digits, spaces, +, - and brackets';

export const EventInformationInputSchema = z.object({
  // Still mandatory: it is one of SCRUM-82's submission fields, so an event
  // cannot be left without one after it was submitted with one.
  description: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : value),
    eventRequestCoreSchema.shape.description.max(2000, 'Description must be 2000 characters or fewer'),
  ),
  internalNotes: optionalText(2000, 'Internal notes'),
  clientContactName: optionalText(200, 'Client contact name'),
  clientContactEmail: z.preprocess(blankToNull, z.string().max(254).email(EMAIL_MESSAGE).nullable().default(null)),
  clientContactPhone: z.preprocess(
    blankToNull,
    z
      .string()
      .max(30, 'Client contact phone must be 30 characters or fewer')
      .regex(/^\+?[0-9 ()-]{3,}$/, PHONE_MESSAGE)
      .nullable()
      .default(null),
  ),
});
export type EventInformationInput = z.infer<typeof EventInformationInputSchema>;

/** What the coordinator's page shows, and whether it offers the edit action. */
export interface EventInformationView extends EventInformationInput {
  description: string;
  /** AC1: the assigned coordinator, and the event not Completed or Cancelled. */
  canEdit: boolean;
  /** AC5: why there is no edit action, or null. */
  readOnlyReason: string | null;
}
