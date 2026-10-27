import { z } from 'zod';
import { RoomLayoutSchema } from '@/domain/venues/schema';
import { isISODate } from '@/domain/shared/dates';
import {
  EndTimeSchema,
  isQuarterHourEnd,
  isQuarterHourStart,
  StartTimeSchema,
  toMinutes,
} from '@/domain/shared/times';

// Agreed shape for the base event request — confirmed with owner of SCRUM-76/77.
// NOTE: `status` (draft/submitted) belongs to SCRUM-84's story, and `coordinatorId`
// belongs to SCRUM-94/95/96 — intentionally left out of this schema to avoid collisions.

export const PROPOSED_DATE_INVALID_MESSAGE = 'Choose a valid date.';

/**
 * The proposed date as typed: a real YYYY-MM-DD, the same check every other
 * date field uses (isISODate), then read as midnight UTC so the rest of the
 * code still receives a Date. z.coerce.date() accepted a five-digit year such
 * as 20266, which toISOString() writes as "+020266-12-10" and Postgres refuses
 * with a raw "time zone displacement out of range" error.
 */
export const proposedDateSchema = z
  .string({
    required_error: PROPOSED_DATE_INVALID_MESSAGE,
    invalid_type_error: PROPOSED_DATE_INVALID_MESSAGE,
  })
  .refine(isISODate, PROPOSED_DATE_INVALID_MESSAGE)
  .transform((value) => new Date(`${value}T00:00:00Z`));

export const eventRequestCoreSchema = z.object({
  name: z.string().min(1, 'Event name is required'),
  purpose: z.string().min(1, 'Purpose is required'),
  description: z.string().min(1, 'Description is required'),
  proposedDate: proposedDateSchema,
  // SCRUM-238 — the event's own start and end, Singapore clock time on the
  // 15-minute unit. Replaces SCRUM-77's timeSlots in the mandatory set.
  startTime: z.string({ required_error: 'Start time is required' }).pipe(StartTimeSchema),
  endTime: z.string({ required_error: 'End time is required' }).pipe(EndTimeSchema),
  expectedAttendance: z
    .number({
      required_error: 'Expected attendance is required',
      invalid_type_error: 'Expected attendance must be a positive whole number',
    })
    .int('Expected attendance must be a positive whole number')
    .positive('Expected attendance must be a positive whole number'),
});

export type EventRequestCore = z.infer<typeof eventRequestCoreSchema>;

/**
 * An untouched form input arrives as ''. That means "not entered", not "invalid".
 * Introduced by SCRUM-83 for the draft schema; also how SCRUM-79's optional
 * venue requirements read a blank select, and SCRUM-230's on a booking request.
 */
export function optionalFromBlank<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (value === '' || value === null ? undefined : value), schema.optional());
}

// ---------------------------------------------------------------------------
// SCRUM-76 — Create an event request with basic details
// ---------------------------------------------------------------------------
// SCRUM-76's slice of the core schema: the four basic details, all mandatory
// on save (US-5.1-TC05: a blank purpose blocks the save and is named).
//
// What is NOT checked here is the date's value. AC3's "saving it as a draft
// remains allowed" means a request with a past date can still be saved - it is
// only refused at submission, which is SCRUM-82's, using
// isProposedDateSubmittable() from policy.ts.
//
// timeSlots (77) and expectedAttendance (78) are left to their own tickets.

export const eventRequestBasicDetailsSchema = eventRequestCoreSchema.pick({
  name: true,
  purpose: true,
  description: true,
  proposedDate: true,
});

export type EventRequestBasicDetails = z.infer<typeof eventRequestBasicDetailsSchema>;

// ---------------------------------------------------------------------------
// SCRUM-77 — Choose the time slots the event needs
// ---------------------------------------------------------------------------
// Superseded by SCRUM-238 (customer change Week 7 #1): a request carries a
// start and end time, below. The slot definitions (TimeSlotEnum,
// TIME_SLOT_HOURS, TIME_SLOT_LABELS, timeSlotsSchema) were removed by
// SCRUM-239 Part 3, once venue booking requests moved to times and nothing
// showed slots. SCRUM-77 stays Done (Week 7 guide, scenario 2). Old rows keep
// their time_slots column, with times filled from it by
// 20261008140500_time_model.sql (AM 07:00-12:00, PM 13:00-18:00, Night
// 19:00-24:00).

// ---------------------------------------------------------------------------
// SCRUM-238 — Request event times in 15-minute steps
// ---------------------------------------------------------------------------
// AC4: a time off the 15-minute unit (10:10, 10:15:30) is refused by the
// shared StartTimeSchema / EndTimeSchema (src/domain/shared/times.ts), the
// same rule every time-taking route uses. AC7: the times are Singapore clock
// times with no zone - stored in Postgres `time` columns and shown as typed,
// so nothing converts them through the browser's time zone.

export const END_NOT_AFTER_START_MESSAGE = 'The end time must be after the start time.';

/**
 * AC2 — the issues to raise when a start and end are both given but the end
 * is not after the start: one on each field, so both are identified. Also
 * raises one on whichever half is missing when only one was given, because a
 * request stores both or neither (event_request_times_together).
 *
 * Used by both saves here and by the submission check (incompleteFields in
 * policy.ts), so the rule is written once.
 */
export function timeRangeIssues(
  startTime: string | undefined,
  endTime: string | undefined,
): { field: 'startTime' | 'endTime'; message: string }[] {
  if (startTime === undefined && endTime === undefined) return [];
  if (startTime === undefined) return [{ field: 'startTime', message: 'Enter a start time as well as the end time.' }];
  if (endTime === undefined) return [{ field: 'endTime', message: 'Enter an end time as well as the start time.' }];
  // Zod still runs the refinement when a field has already failed (AC4), and
  // toMinutes throws on an off-step time, so only compare two valid times.
  if (!isQuarterHourStart(startTime) || !isQuarterHourEnd(endTime)) return [];
  if (toMinutes(endTime) <= toMinutes(startTime)) {
    return [
      { field: 'startTime', message: END_NOT_AFTER_START_MESSAGE },
      { field: 'endTime', message: END_NOT_AFTER_START_MESSAGE },
    ];
  }
  return [];
}

/** The two time fields as both saves accept them: blank is "not yet entered". */
const eventTimesShape = {
  startTime: optionalFromBlank(StartTimeSchema),
  endTime: optionalFromBlank(EndTimeSchema),
};

function refineTimeRange(value: { startTime?: string; endTime?: string }, ctx: z.RefinementCtx): void {
  for (const issue of timeRangeIssues(value.startTime, value.endTime)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.field], message: issue.message });
  }
}

// ---------------------------------------------------------------------------
// SCRUM-79 — State venue and accessibility requirements
// ---------------------------------------------------------------------------
// None of these is mandatory to save or to submit: the Jira card asks that
// what the organiser states is saved, not that they must state it. They are
// spread into both the save schema (SCRUM-76) and the draft schema (SCRUM-83)
// because both write the same row.

export const ACCESSIBILITY_NOTES_MAX_LENGTH = 1000;

/**
 * AC1 — the layout is one of the seven the venue catalogue knows. The list is
 * imported from the catalogue (SCRUM-118) rather than copied, so a request
 * can never ask for a layout no venue could be recorded as supporting.
 *
 * AC2/AC3 — accessibility is answered in three parts. `accessibilityRequired`
 * is the answer itself: undefined is "not yet answered", false is "none"
 * (AC3), true is "yes" with the features and notes saying what. The features
 * are ids from the maintained list (SCRUM-117). Whether features and notes are
 * kept when the answer is not "yes" is normaliseAccessibility() in policy.ts.
 *
 * AC4 — the preferred location is an id from the maintained location list
 * (SCRUM-116). Left blank, it is "no preference"; nothing else is stored.
 */
export const venueRequirementsShape = {
  roomLayout: optionalFromBlank(RoomLayoutSchema),
  accessibilityRequired: optionalFromBlank(z.boolean()),
  accessibilityFeatureIds: z
    .array(z.string().uuid('Each accessibility feature must be chosen from the list.'))
    .default([]),
  accessibilityNotes: optionalFromBlank(
    z
      .string()
      .max(
        ACCESSIBILITY_NOTES_MAX_LENGTH,
        `Accessibility notes must be ${ACCESSIBILITY_NOTES_MAX_LENGTH} characters or fewer.`,
      ),
  ),
  preferredLocationId: optionalFromBlank(
    z.string().uuid('Preferred location must be chosen from the list.'),
  ),
};

// ---------------------------------------------------------------------------
// SCRUM-80 — State equipment and technical support requirements
// ---------------------------------------------------------------------------
// Same three-part shape as accessibility above: an explicit answer, the
// detail, and free text. The one difference is deliberate: the technical
// support description stands on its own (AC2, "whether or not any equipment
// item has been added"), so it is never dropped when the answer is "none".
//
// No equipment catalogue exists in this sprint, so an item is its name.

export const EQUIPMENT_ITEM_MAX_LENGTH = 100;
export const TECHNICAL_SUPPORT_NOTES_MAX_LENGTH = 1000;

/** AC1 — an item and how many of it. */
export const equipmentItemSchema = z.object({
  item: z
    .string({ required_error: 'Equipment item is required' })
    .trim()
    .min(1, 'Equipment item is required')
    .max(EQUIPMENT_ITEM_MAX_LENGTH, `Equipment item must be ${EQUIPMENT_ITEM_MAX_LENGTH} characters or fewer`),
  quantity: z
    .number({ required_error: 'Quantity is required', invalid_type_error: 'Quantity must be a whole number' })
    .int('Quantity must be a whole number')
    .positive('Quantity must be greater than 0'),
});
export type EquipmentItem = z.infer<typeof equipmentItemSchema>;

export const equipmentRequirementsShape = {
  equipmentRequired: optionalFromBlank(z.boolean()),
  equipmentItems: z
    .array(equipmentItemSchema)
    .default([])
    .refine(
      (items) => new Set(items.map((entry) => entry.item.toLowerCase())).size === items.length,
      'Each equipment item can only be listed once',
    ),
  technicalSupportNotes: optionalFromBlank(
    z
      .string()
      .max(
        TECHNICAL_SUPPORT_NOTES_MAX_LENGTH,
        `Technical support notes must be ${TECHNICAL_SUPPORT_NOTES_MAX_LENGTH} characters or fewer.`,
      ),
  ),
};

// ---------------------------------------------------------------------------
// SCRUM-81 — Indicate whether attendee registration is required
// ---------------------------------------------------------------------------
// One explicit answer. Undefined is "not yet answered"; true is AC1; false is
// AC2/AC3. Attendee Registration itself is a later sprint, so there is nothing
// else to record alongside it.
export const registrationShape = {
  registrationRequired: optionalFromBlank(z.boolean()),
};

/** US-5.2's optional block: SCRUM-79's venue requirements, SCRUM-80's equipment, SCRUM-81's registration. */
export const venueRequirementsSchema = z.object({
  ...venueRequirementsShape,
  ...equipmentRequirementsShape,
  ...registrationShape,
});
export type VenueRequirementsInput = z.infer<typeof venueRequirementsSchema>;

/**
 * The whole form as it is saved: SCRUM-76's basic details, SCRUM-77's slots,
 * SCRUM-78's attendance, and US-5.2's optional block (SCRUM-79, 80, 81).
 */
export const eventRequestSaveSchema = eventRequestBasicDetailsSchema
  .extend({
    // SCRUM-238. Optional on save, like attendance below: only submission
    // enforces the mandatory set. AC2's end-after-start rule does apply on save.
    ...eventTimesShape,
    // SCRUM-78. Optional here, same as the times: AC3's date rule already
    // establishes that "Save request" doesn't enforce the mandatory set - only
    // submission does (incompleteFields, SCRUM-82). Reuses the core schema's
    // stricter rule (whole number, greater than 0) via
    // schema.shape.expectedAttendance, so a real value is still validated the
    // same way everywhere; optionalFromBlank additionally lets a blank or
    // explicit null through as "not entered", matching the draft schema's
    // handling of the same situation rather than treating save and draft
    // differently for no reason.
    expectedAttendance: optionalFromBlank(eventRequestCoreSchema.shape.expectedAttendance),
    ...venueRequirementsSchema.shape,
  })
  .superRefine(refineTimeRange);

export type EventRequestSaveInput = z.infer<typeof eventRequestSaveSchema>;

// ---------------------------------------------------------------------------
// SCRUM-82 — Submit a completed event request
// ---------------------------------------------------------------------------
// AC1 says "its status changes to Submitted", so a status has to exist here.
// Kept to the two values this story needs. The NOTE at the top of this file
// still stands: the wider lifecycle (Event Status Management) is not in this
// sprint and should extend this enum rather than replace it.
// SCRUM-92 extended this with 'approved', matching the Postgres enum (see
// supabase/migrations/20260912154742_event_request_approved_status.sql) so the
// contract and the database agree. SCRUM-93 adds 'rejected' the same way, via
// supabase/migrations/20260920140000_event_request_rejected_status.sql.
// SCRUM-90 extends this with 'clarification_requested', matching
// supabase/migrations/20260914090000_event_request_clarification_requested_status.sql.
//
// SCRUM-101 (Event Status Management, Sprint 2) AC3/AC4 adds 'planning',
// matching supabase/migrations/20260927090100_event_request_planning_status.sql.
// SCRUM-103 adds the rest of the lifecycle its ACs name - confirmed,
// completed, cancelled (and planning, with IF NOT EXISTS) - via
// supabase/migrations/20260928120000_event_request_lifecycle_statuses.sql.
// Which moves between them are allowed lives in domain/event-status/policy.ts.
export const EventRequestStatusEnum = z.enum([
  'draft',
  'submitted',
  'approved',
  'clarification_requested',
  'rejected',
  'planning',
  'confirmed',
  // SCRUM-234 AC3: Confirmed and passed the operational safety check.
  'preparation',
  'completed',
  'cancelled',
]);
export type EventRequestStatus = z.infer<typeof EventRequestStatusEnum>;

/** AC3/AC4 (US-5.3-TC03): the status as the organiser sees it, one spelling everywhere. */
export const EVENT_REQUEST_STATUS_LABELS: Record<EventRequestStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  clarification_requested: 'Clarification Requested',
  rejected: 'Rejected',
  planning: 'Planning',
  confirmed: 'Confirmed',
  preparation: 'Preparation',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/**
 * SCRUM-99 AC1 — the one-line definition shown with the status on the event
 * page. The wording is a team proposal: the card cites no customer clarification.
 * Written about the request, not to "you", because a colleague in the same
 * organisation may view it too (SCRUM-204 AC3) but cannot answer a
 * clarification or see a rejection reason.
 */
export const EVENT_REQUEST_STATUS_DEFINITIONS: Record<EventRequestStatus, string> = {
  draft: 'Being prepared and not yet sent for review.',
  submitted: "Sent for review and waiting for a coordinator's decision.",
  approved: 'Approved, so planning can begin; no venue or equipment is committed yet.',
  clarification_requested: 'The coordinator needs more information from the organiser before deciding.',
  rejected: 'Not approved; it cannot be edited or resubmitted.',
  planning: 'Venue and equipment arrangements are being made.',
  confirmed: 'All essential arrangements are in place.',
  // SCRUM-234 card notes (TC-234-19).
  preparation: 'Passed its safety check and being prepared for the day.',
  completed: 'The event has taken place.',
  cancelled: 'The event has been called off and will not go ahead.',
};

// ---------------------------------------------------------------------------
// SCRUM-83 — Save an incomplete request as a draft
// ---------------------------------------------------------------------------
// US-6.1 AC1: "stored as a draft with whatever fields are completed;
// mandatory-field validation is not applied". This is a DIFFERENT action from
// SCRUM-76's save, not a replacement for it:
//
//   eventRequestSaveSchema  (SCRUM-76) — "Save request": US-5.1 AC5 applies,
//                                        the basic details are mandatory.
//   eventRequestDraftSchema (SCRUM-83) — "Save as draft": nothing but the name
//                                        is required.
//
// Both write the same row, and a row is DRAFT either way (the column defaults
// to it) - the difference is only how much must be filled in before the save
// is allowed.
//
// Why `name` is still required: the column is `not null` with a non-blank
// check (SCRUM-76's migration), the event list needs something to label a
// draft with (AC2), and US-6.1-TC01 supplies one ("Only the event name has
// been entered"). Relaxing it would mean altering a shared table and the
// row/write types every other event-request story depends on.
//
// AC1's second half - "only format checks are applied to values I have
// actually entered" - is why each field reuses its own rule from
// eventRequestCoreSchema: an attendance of -5 is still refused on a draft, it
// is only a *missing* attendance that is tolerated. (optionalFromBlank, the
// helper that reads a blank input as "not entered", is defined near the top
// of this file.)

export const eventRequestDraftSchema = z
  .object({
    name: eventRequestCoreSchema.shape.name,
    purpose: optionalFromBlank(eventRequestCoreSchema.shape.purpose),
    description: optionalFromBlank(eventRequestCoreSchema.shape.description),
    proposedDate: optionalFromBlank(eventRequestCoreSchema.shape.proposedDate),
    expectedAttendance: optionalFromBlank(eventRequestCoreSchema.shape.expectedAttendance),
    // SCRUM-238 AC2 ("when I save or submit") — the end-after-start rule is a
    // check on values entered, so it applies to a draft too.
    ...eventTimesShape,
    // SCRUM-79 / 80 / 81 — a draft keeps whatever requirements were stated so far.
    ...venueRequirementsSchema.shape,
  })
  .superRefine(refineTimeRange);

export type EventRequestDraftInput = z.infer<typeof eventRequestDraftSchema>;

// "The proposed mandatory set" (AC1/AC2, customer clarification #72/#73) is
// taken to be every field of eventRequestCoreSchema - the shape US-5.1 agreed.
// Each key is paired with the name shown to the organiser when it is missing,
// which is what AC2's "listed by name" means in practice.
export const MANDATORY_FIELD_LABELS = {
  name: 'Event name',
  purpose: 'Purpose',
  description: 'Description',
  proposedDate: 'Proposed date',
  // SCRUM-238 — replaces SCRUM-77's 'Time slots'.
  startTime: 'Start time',
  endTime: 'End time',
  expectedAttendance: 'Expected attendance',
} as const satisfies Record<keyof EventRequestCore, string>;

export type MandatoryField = keyof typeof MANDATORY_FIELD_LABELS;