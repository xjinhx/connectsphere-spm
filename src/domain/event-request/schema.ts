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