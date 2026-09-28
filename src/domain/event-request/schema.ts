import { z } from 'zod';
import { RoomLayoutSchema } from '@/domain/venues/schema';

// Agreed shape for the base event request — confirmed with owner of SCRUM-76/77.
// NOTE: `status` (draft/submitted) belongs to SCRUM-84's story, and `coordinatorId`
// belongs to SCRUM-94/95/96 — intentionally left out of this schema to avoid collisions.

export const TimeSlotEnum = z.enum(['am', 'pm', 'night']); // 7am-12pm, 1pm-6pm, 7pm-12am

export const eventRequestCoreSchema = z.object({
  name: z.string().min(1, 'Event name is required'),
  purpose: z.string().min(1, 'Purpose is required'),
  description: z.string().min(1, 'Description is required'),
  proposedDate: z.coerce.date(),
  timeSlots: z.array(TimeSlotEnum).min(1, 'Select at least one time slot'),
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
 * venue requirements read a blank select.
 */
function optionalFromBlank<T extends z.ZodTypeAny>(schema: T) {
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
// AC4: these three are the only slots that exist (customer clarification #50).
// Venues are booked in these fixed blocks, so a request cannot ask for a slot
// that crosses midnight - there is no such slot to ask for.

export type TimeSlot = z.infer<typeof TimeSlotEnum>;

/** The slots in the order a day runs. Also the order they are stored and shown. */
export const TIME_SLOT_ORDER: readonly TimeSlot[] = TimeSlotEnum.options;

export const TIME_SLOT_HOURS: Record<TimeSlot, { start: number; end: number }> = {
  am: { start: 7, end: 12 },
  pm: { start: 13, end: 18 },
  night: { start: 19, end: 24 },
};

export const TIME_SLOT_LABELS: Record<TimeSlot, string> = {
  am: 'AM (07:00–12:00)',
  pm: 'PM (13:00–18:00)',
  night: 'Night (19:00–24:00)',
};

/** A selection is a set: duplicates collapse, and the order is the day's order. */
export function normaliseTimeSlots(slots: readonly TimeSlot[]): TimeSlot[] {
  return TIME_SLOT_ORDER.filter((slot) => slots.includes(slot));
}

/**
 * AC1: what is saved with the request. Any number of slots, including none -
 * AC3 blocks submission without a slot, not saving. `.min(1)` stays on the
 * core schema, where the completeness check (SCRUM-82) reads it.
 */
export const timeSlotsSchema = z.array(TimeSlotEnum).transform(normaliseTimeSlots);

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
export const eventRequestSaveSchema = eventRequestBasicDetailsSchema.extend({
  timeSlots: timeSlotsSchema.default([]),
  // SCRUM-78. Optional here, same as timeSlots: AC3's date rule already
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
});

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
// SCRUM-103 adds the rest of the lifecycle its ACs name - planning, confirmed,
// completed, cancelled - via
// supabase/migrations/20260928120000_event_request_lifecycle_statuses.sql.
// Planning is SCRUM-101's status (its own migration is not on main yet); it is
// here now because SCRUM-103's ACs need it.
// DUMMY(SCRUM-101) D-10: 'planning' added by SCRUM-103 until SCRUM-101 is on main.
// Which moves between them are allowed lives in domain/event-status/policy.ts.
export const EventRequestStatusEnum = z.enum([
  'draft',
  'submitted',
  'approved',
  'clarification_requested',
  'rejected',
  'planning',
  'confirmed',
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
  completed: 'Completed',
  cancelled: 'Cancelled',
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

export const eventRequestDraftSchema = z.object({
  name: eventRequestCoreSchema.shape.name,
  purpose: optionalFromBlank(eventRequestCoreSchema.shape.purpose),
  description: optionalFromBlank(eventRequestCoreSchema.shape.description),
  proposedDate: optionalFromBlank(eventRequestCoreSchema.shape.proposedDate),
  expectedAttendance: optionalFromBlank(eventRequestCoreSchema.shape.expectedAttendance),
  timeSlots: timeSlotsSchema.default([]),
  // SCRUM-79 / 80 / 81 — a draft keeps whatever requirements were stated so far.
  ...venueRequirementsSchema.shape,
});

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
  timeSlots: 'Time slots',
  expectedAttendance: 'Expected attendance',
} as const satisfies Record<keyof EventRequestCore, string>;

export type MandatoryField = keyof typeof MANDATORY_FIELD_LABELS;