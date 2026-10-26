import { z } from 'zod';
import { QUANTITY_COLUMN_MAX } from '@/domain/equipment/schema';

/**
 * SCRUM-170 Exclude equipment that is unavailable, damaged or under
 * maintenance: data shapes shared by the API route and the catalogue page.
 *
 * Each catalogue item keeps its total quantity (SCRUM-240); Technical Support
 * Staff record how many of those units are out of service, as a count per
 * status (the card's Notes, refinement item 7, CL-46).
 */

/** The statuses a unit can be out of service with: SCRUM-240 AC2's four, less Available. */
export const OUT_OF_SERVICE_STATUSES = ['unavailable', 'damaged', 'underMaintenance'] as const;
export type OutOfServiceStatus = (typeof OUT_OF_SERVICE_STATUSES)[number];

export const OUT_OF_SERVICE_LABELS: Record<OutOfServiceStatus, string> = {
  unavailable: 'Unavailable',
  damaged: 'Damaged',
  underMaintenance: 'Under maintenance',
};

/**
 * AC4: "fewer than zero ... is refused and the quantity field is identified".
 * A whole number of at least zero; the field it belongs to is named by the
 * parse (flatten), so the form pins the message on that box.
 */
const UnitsSchema = z
  .number({ required_error: 'Enter a number of units.', invalid_type_error: 'Units must be a whole number.' })
  .int('Units must be a whole number.')
  .min(0, 'Units out of service cannot be below zero.')
  .max(QUANTITY_COLUMN_MAX, 'Too many units.');

/**
 * AC1, AC2: the units of one item out of service, by status. Recording two
 * Damaged sets damaged to 2; returning one to service sets it to 1.
 */
export const OutOfServiceCountsSchema = z.object({
  unavailable: UnitsSchema,
  damaged: UnitsSchema,
  underMaintenance: UnitsSchema,
});
export type OutOfServiceCounts = z.infer<typeof OutOfServiceCountsSchema>;

export const NO_UNITS_OUT_OF_SERVICE: OutOfServiceCounts = { unavailable: 0, damaged: 0, underMaintenance: 0 };

/** An item's counts as the API returns them, with its total quantity. */
export const ItemOutOfServiceSchema = z.object({
  equipmentId: z.string().uuid(),
  quantity: z.number().int().min(0),
  counts: OutOfServiceCountsSchema,
});
export type ItemOutOfService = z.infer<typeof ItemOutOfServiceSchema>;
