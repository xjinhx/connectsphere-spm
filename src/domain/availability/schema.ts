import { z } from 'zod';
import { isISODate } from '@/domain/shared/dates';
import { OperatingSlotSchema, type OperatingSlot } from '@/domain/venues/schema';

/**
 * Venue availability (EP-13): data shapes shared by the API route and the UI.
 *
 * SCRUM-151 Withdraw venue availability when circumstances change
 *
 * An unavailable slot (CONTEXT.md) is one slot at one venue on one date that
 * Venue Staff have withdrawn from use, with the reason recorded. Values mirror
 * the check constraints in
 * supabase/migrations/20260928100000_venue_unavailable_slot.sql.
 *
 * Slots reuse the venue catalogue's AM / PM / Night list (OperatingSlotSchema)
 * rather than a second copy of the same three values.
 */

/** Short names for messages and lists: "AM", not "AM (07:00-12:00)". */
export const SLOT_NAMES: Record<OperatingSlot, string> = {
  am: 'AM',
  pm: 'PM',
  night: 'Night',
};

/**
 * SCRUM-151 AC1: "I select a venue, a date and the affected slots and record a
 * reason". The venue comes from the URL. Several slots can be ticked in one
 * save, and each is recorded as its own unavailable slot.
 */
export const MarkSlotsUnavailableInputSchema = z.object({
  date: z.string({ required_error: 'Choose a date.' }).refine(isISODate, 'Choose a valid date.'),
  slots: z
    .array(OperatingSlotSchema, { required_error: 'Select at least one slot.' })
    .min(1, 'Select at least one slot.')
    .refine((slots) => new Set(slots).size === slots.length, 'Each slot can only be selected once.'),
  reason: z.string({ required_error: 'A reason is required.' }).trim().min(1, 'A reason is required.'),
});
export type MarkSlotsUnavailableInput = z.infer<typeof MarkSlotsUnavailableInputSchema>;

/**
 * SCRUM-151 AC3: an affected booking (CONTEXT.md) as the coordinator's event
 * page lists it: which venue and date, and each of its slots that has been
 * withdrawn, with the reason recorded for it.
 */
export const BookingOnUnavailableSlotSchema = z.object({
  bookingId: z.string().uuid(),
  venueId: z.string().uuid(),
  venueName: z.string(),
  date: z.string(),
  slots: z.array(z.object({ slot: OperatingSlotSchema, reason: z.string() })).min(1),
});
export type BookingOnUnavailableSlot = z.infer<typeof BookingOnUnavailableSlotSchema>;

/** One recorded unavailable slot, as the API and the venue page show it. */
export const UnavailableSlotSchema = z.object({
  id: z.string().uuid(),
  venueId: z.string().uuid(),
  date: z.string(),
  slot: OperatingSlotSchema,
  reason: z.string(),
  recordedAt: z.string(),
});
export type UnavailableSlot = z.infer<typeof UnavailableSlotSchema>;
