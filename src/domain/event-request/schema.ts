import { z } from 'zod';

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
    .number({ required_error: 'Expected attendance is required' })
    .int('Expected attendance must be a whole number')
    .positive('Expected attendance must be greater than 0'),
});

export type EventRequestCore = z.infer<typeof eventRequestCoreSchema>;

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

/** The whole form as it is saved: SCRUM-76's basic details plus SCRUM-77's slots. */
export const eventRequestSaveSchema = eventRequestBasicDetailsSchema.extend({
  timeSlots: timeSlotsSchema.default([]),
});

export type EventRequestSaveInput = z.infer<typeof eventRequestSaveSchema>;

// ---------------------------------------------------------------------------
// SCRUM-82 — Submit a completed event request
// ---------------------------------------------------------------------------
// AC1 says "its status changes to Submitted", so a status has to exist here.
// Kept to the two values this story needs. The NOTE at the top of this file
// still stands: the wider lifecycle (Event Status Management) is not in this
// sprint and should extend this enum rather than replace it.
export const EventRequestStatusEnum = z.enum(['draft', 'submitted']);
export type EventRequestStatus = z.infer<typeof EventRequestStatusEnum>;

/** AC3/AC4 (US-5.3-TC03): the status as the organiser sees it, one spelling everywhere. */
export const EVENT_REQUEST_STATUS_LABELS: Record<EventRequestStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
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
// is only a *missing* attendance that is tolerated.

/** An untouched form input arrives as ''. That means "not entered", not "invalid". */
function optionalFromBlank<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (value === '' || value === null ? undefined : value), schema.optional());
}

export const eventRequestDraftSchema = z.object({
  name: eventRequestCoreSchema.shape.name,
  purpose: optionalFromBlank(eventRequestCoreSchema.shape.purpose),
  description: optionalFromBlank(eventRequestCoreSchema.shape.description),
  proposedDate: optionalFromBlank(eventRequestCoreSchema.shape.proposedDate),
  expectedAttendance: optionalFromBlank(eventRequestCoreSchema.shape.expectedAttendance),
  timeSlots: timeSlotsSchema.default([]),
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