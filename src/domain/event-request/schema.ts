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
