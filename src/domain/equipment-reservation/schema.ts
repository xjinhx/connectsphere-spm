import { z } from 'zod';

/**
 * Equipment availability and reservation: data shapes shared by the API routes
 * and the UI.
 *
 * SCRUM-167 Check equipment availability across the full commitment window
 *
 * An event's equipment request (SCRUM-160) says what it needs; this is how
 * much of each item is free for it over its commitment window.
 */

/**
 * The commitment window (167 Definitions, CL-29): the day before the event's
 * first confirmed venue booking (collection) to its last (Return Day), both
 * included, as YYYY-MM-DD.
 */
export const DateWindowSchema = z.object({ start: z.string(), end: z.string() });
export type DateWindow = z.infer<typeof DateWindowSchema>;

/** 167 AC3: "the check is refused and I am told the event needs an approved venue booking first". */
export const CHECK_NEEDS_APPROVED_BOOKING_MESSAGE = 'This event needs an approved venue booking first.';

/**
 * 167 AC4: one line of the event's equipment request, checked. "The quantity
 * requested, the quantity already reserved for this event, the quantity
 * available for the window and the shortfall, shown as zero when the request
 * is fully covered. The event's own reservations are not counted against it."
 * - available (167 Definitions, CL-46): the item's quantity less the most
 *   units other events hold on any one day of the window, never below 0. Units
 *   this event has reserved are available to it;
 * - shortfall: requested units that available does not cover. 0 when covered.
 */
export const AvailabilityLineSchema = z.object({
  lineId: z.string().uuid(),
  equipmentId: z.string().uuid(),
  equipmentName: z.string(),
  requested: z.number().int().min(1),
  alreadyReserved: z.number().int().min(0),
  available: z.number().int().min(0),
  shortfall: z.number().int().min(0),
});
export type AvailabilityLine = z.infer<typeof AvailabilityLineSchema>;

/** SCRUM-167: the check of an event's whole equipment request over its window. */
export const EquipmentAvailabilitySchema = z.object({
  eventRequestId: z.string().uuid(),
  window: DateWindowSchema,
  lines: z.array(AvailabilityLineSchema),
});
export type EquipmentAvailability = z.infer<typeof EquipmentAvailabilitySchema>;
