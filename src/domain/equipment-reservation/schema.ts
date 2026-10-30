import { z } from 'zod';
import { RequestedQuantitySchema } from '@/domain/equipment-request/schema';

/**
 * Equipment availability and reservation: data shapes shared by the API routes
 * and the UI.
 *
 * SCRUM-167 Check equipment availability across the full commitment window
 * SCRUM-173 Reserve equipment for the full commitment window and view all
 *           reservations for the event
 * SCRUM-177 Release a reservation
 *
 * An event's equipment request (SCRUM-160) says what it needs; this is how
 * much of each item is free for it, and what has been set aside for it.
 */

/**
 * The commitment window (167 AC1, 173 AC3): the day before the event's first
 * confirmed venue booking (collection) to its last (Return Day), both
 * included, as YYYY-MM-DD.
 */
export const DateWindowSchema = z.object({ start: z.string(), end: z.string() });
export type DateWindow = z.infer<typeof DateWindowSchema>;

/** 167 AC3: "the check is refused and I am told the event needs an approved venue booking first". */
export const CHECK_NEEDS_APPROVED_BOOKING_MESSAGE = 'This event needs an approved venue booking first.';

/** 173 AC2: "told the event needs an approved venue booking before equipment can be committed". */
export const RESERVE_NEEDS_APPROVED_BOOKING_MESSAGE =
  'This event needs an approved venue booking before equipment can be committed.';

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

/**
 * SCRUM-173 AC1: "reserve" a quantity of one line's item. The same whole
 * number of at least one as the line itself (SCRUM-160 AC2).
 */
export const ReserveEquipmentInputSchema = z.object({ quantity: RequestedQuantitySchema });
export type ReserveEquipmentInput = z.infer<typeof ReserveEquipmentInputSchema>;

/** 173 AC6: Reserved, or Released once released (SCRUM-177). */
export const RESERVATION_STATUSES = ['reserved', 'released'] as const;
export const ReservationStatusSchema = z.enum(RESERVATION_STATUSES);
export type ReservationStatus = z.infer<typeof ReservationStatusSchema>;

export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  reserved: 'Reserved',
  released: 'Released',
};

/** 173 AC6: "lists item, quantity, window and status". */
export const EquipmentReservationSchema = z.object({
  id: z.string().uuid(),
  lineId: z.string().uuid(),
  equipmentId: z.string().uuid(),
  equipmentName: z.string(),
  quantity: z.number().int().min(1),
  window: DateWindowSchema,
  status: ReservationStatusSchema,
  reservedAt: z.string(),
  // SCRUM-111 AC7: set by a significant change to the event's date or times,
  // cleared when its coordinator re-confirms it (AC9).
  reviewRequired: z.boolean(),
  reviewRequiredAt: z.string().nullable(),
  reviewRequiredCause: z.string().nullable(),
  // SCRUM-177 AC5: why and when it was released; null while it is Reserved.
  releaseReason: z.string().nullable(),
  releasedAt: z.string().nullable(),
});
export type EquipmentReservation = z.infer<typeof EquipmentReservationSchema>;

export const RELEASE_RESERVATION_REASON_REQUIRED = 'A reason is required to release a reservation.';

/** SCRUM-177 AC1: Technical Support Staff release a reservation "and give a reason". */
export const ReleaseReservationInputSchema = z.object({
  reason: z
    .string({ required_error: RELEASE_RESERVATION_REASON_REQUIRED })
    .trim()
    .min(1, RELEASE_RESERVATION_REASON_REQUIRED),
});
export type ReleaseReservationInput = z.infer<typeof ReleaseReservationInputSchema>;

/** 173 AC7: a line not yet fully reserved, and by how much. */
export const OutstandingLineSchema = z.object({
  lineId: z.string().uuid(),
  equipmentName: z.string(),
  requested: z.number().int().min(1),
  reserved: z.number().int().min(0),
  outstanding: z.number().int().min(1),
});
export type OutstandingLine = z.infer<typeof OutstandingLineSchema>;

/** 173 AC6, AC7: the event's equipment section. */
export const EventReservationsSchema = z.object({
  eventRequestId: z.string().uuid(),
  reservations: z.array(EquipmentReservationSchema),
  outstanding: z.array(OutstandingLineSchema),
});
export type EventReservations = z.infer<typeof EventReservationsSchema>;
