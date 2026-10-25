import { z } from 'zod';

/**
 * SCRUM-187 — Request a change and track its outcome.
 *
 * Field scope deliberately narrow for now: the subset in scope whichever way
 * the PO answers the AC1 field-scope question (Slack, 24 Oct 2026) - date,
 * times, expected attendance, venue requirements, equipment requirements.
 * Widening to the full event-request field set (name, purpose, description,
 * registrationRequired) is a follow-up once that's confirmed; see the
 * migration note in 20261024090000_change_request.sql.
 */
export const SELECTABLE_CHANGE_REQUEST_FIELDS = [
  'proposedDate',
  'startTime',
  'endTime',
  'expectedAttendance',
  'roomLayout',
  'accessibilityRequired',
  'accessibilityFeatureIds',
  'accessibilityNotes',
  'preferredLocationId',
  'equipmentRequired',
  'equipmentItems',
  'technicalSupportNotes',
] as const;
export const SelectableChangeRequestFieldSchema = z.enum(SELECTABLE_CHANGE_REQUEST_FIELDS);
export type SelectableChangeRequestField = z.infer<typeof SelectableChangeRequestFieldSchema>;

/** AC6's "what was asked" and the raise form both name fields the same way. */
export const CHANGE_REQUEST_FIELD_LABELS: Record<SelectableChangeRequestField, string> = {
  proposedDate: 'Proposed date',
  startTime: 'Start time',
  endTime: 'End time',
  expectedAttendance: 'Expected attendance',
  roomLayout: 'Room layout',
  accessibilityRequired: 'Accessibility required',
  accessibilityFeatureIds: 'Accessibility features',
  accessibilityNotes: 'Accessibility notes',
  preferredLocationId: 'Preferred location',
  equipmentRequired: 'Equipment required',
  equipmentItems: 'Equipment items',
  technicalSupportNotes: 'Technical support notes',
};

export const ChangeRequestStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export type ChangeRequestStatus = z.infer<typeof ChangeRequestStatusSchema>;

export const CHANGE_REQUEST_STATUS_LABELS: Record<ChangeRequestStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

/**
 * AC1 — "selecting each field to change, entering its proposed value and
 * giving a reason". One reason covers every field selected in the request
 * (not one reason per field): the AC text gives a single "giving a reason"
 * for the whole raise, not one per selected field.
 */
export const RaiseChangeRequestInputSchema = z.object({
  fields: z
    .array(
      z.object({
        field: SelectableChangeRequestFieldSchema,
        proposedValue: z.unknown(),
      }),
    )
    .min(1, 'Select at least one field to change.')
    .refine(
      (fields) => new Set(fields.map((entry) => entry.field)).size === fields.length,
      'Each field can only be selected once.',
    ),
  reason: z
    .string({ required_error: 'A reason is required.' })
    .trim()
    .min(1, 'A reason is required.'),
});
export type RaiseChangeRequestInput = z.infer<typeof RaiseChangeRequestInputSchema>;

export const EventRequestIdSchema = z.string().uuid();
export const ChangeRequestIdSchema = z.string().uuid();
