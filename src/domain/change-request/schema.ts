import { z } from 'zod';
import { equipmentRequirementsShape, venueRequirementsShape } from '@/domain/event-request/schema';

/**
 * SCRUM-187 — Request a change and track its outcome.
 *
 * Field scope: PO clarification, 24 Oct 2026 (CL-61) - any field the
 * organiser fills in on the event request form can be selected, the full
 * event-request field set. Accessibility features and equipment items are
 * one field each, proposed as a whole new list (not one field per item).
 * Which changes flag arrangements for review is SCRUM-190 AC2/SCRUM-111, not
 * this story.
 */
export const SELECTABLE_CHANGE_REQUEST_FIELDS = [
  'name',
  'purpose',
  'description',
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
  'registrationRequired',
] as const;
export const SelectableChangeRequestFieldSchema = z.enum(SELECTABLE_CHANGE_REQUEST_FIELDS);
export type SelectableChangeRequestField = z.infer<typeof SelectableChangeRequestFieldSchema>;

/** AC6's "what was asked" and the raise form both name fields the same way. */
export const CHANGE_REQUEST_FIELD_LABELS: Record<SelectableChangeRequestField, string> = {
  name: 'Event name',
  purpose: 'Purpose',
  description: 'Description',
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
  registrationRequired: 'Registration required',
};

export const ChangeRequestStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export type ChangeRequestStatus = z.infer<typeof ChangeRequestStatusSchema>;

export const CHANGE_REQUEST_STATUS_LABELS: Record<ChangeRequestStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

/** SCRUM-274: the list fields' own rules, from the event request schema. */
const PROPOSED_LIST_SCHEMAS: Partial<Record<SelectableChangeRequestField, z.ZodTypeAny>> = {
  accessibilityFeatureIds: venueRequirementsShape.accessibilityFeatureIds,
  equipmentItems: equipmentRequirementsShape.equipmentItems,
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
      z
        .object({
          field: SelectableChangeRequestFieldSchema,
          proposedValue: z.unknown(),
        })
        // Review feedback, PR #143: the form sends null for an empty text,
        // number, date or time field, and proposedValue: z.unknown() passed
        // it through. The change_request row was then created before the
        // field insert failed on proposed_value not null, leaving a Pending
        // request with nothing asked. Refused here, before anything is
        // written, so a retry cannot leave a second orphan either.
        .refine((entry) => entry.proposedValue !== null && entry.proposedValue !== undefined, {
          message: 'Give the new value for each selected field.',
          path: ['proposedValue'],
        })
        // SCRUM-274: the two list fields are checked the same way the event
        // request form checks them (accessibility features chosen from the
        // list; equipment items named, a whole quantity above 0, no repeats),
        // so a proposal can only hold what the event itself could hold.
        .superRefine((entry, ctx) => {
          const listSchema = PROPOSED_LIST_SCHEMAS[entry.field];
          if (!listSchema || entry.proposedValue === null || entry.proposedValue === undefined) return;
          const parsed = listSchema.safeParse(entry.proposedValue);
          if (!parsed.success) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: parsed.error.issues[0]?.message ?? 'Give a valid value for this field.',
              path: ['proposedValue'],
            });
          }
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
