import { z } from 'zod';

// Agreed shape for the base event request — confirmed with owner of SCRUM-76/77.
// NOTE: `status` (draft/submitted) belongs to SCRUM-84's story, and `coordinatorId`
// belongs to SCRUM-94/95/96 — intentionally left out of this schema to avoid collisions.

export const TimeSlotEnum = z.enum(['AM', 'PM', 'NIGHT']); // 7am-12pm, 1pm-6pm, 7pm-12am

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
  AM: { start: 7, end: 12 },
  PM: { start: 13, end: 18 },
  NIGHT: { start: 19, end: 24 },
};

export const TIME_SLOT_LABELS: Record<TimeSlot, string> = {
  AM: 'AM (07:00–12:00)',
  PM: 'PM (13:00–18:00)',
  NIGHT: 'Night (19:00–24:00)',
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
