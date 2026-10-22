import type { OperationalStatus } from '@/domain/equipment/schema';
import { OUT_OF_SERVICE_LABELS, OUT_OF_SERVICE_STATUSES, type OutOfServiceCounts, type OutOfServiceStatus } from './schema';

/**
 * SCRUM-170 rules. Pure functions: no Supabase, no Next.js.
 *
 * reserve_equipment (supabase/migrations/20261022100038_equipment_out_of_service.sql)
 * applies unitsInService again inside the write, so SCRUM-167's check and
 * SCRUM-173's reservation agree.
 */

/** Every unit out of service, whatever its status. */
export function outOfServiceTotal(counts: OutOfServiceCounts): number {
  return counts.unavailable + counts.damaged + counts.underMaintenance;
}

/**
 * AC4: "Given an item has ten units, when I try to record more than ten ...
 * then it is refused and the quantity field is identified." The limit is on
 * the total across the three statuses (TC-170-08: 8 Damaged and 3 Under
 * maintenance is 11 of 10), and exactly the item's quantity is allowed
 * (TC-170-07).
 *
 * Null when the counts fit. Otherwise the message on each field that changed
 * from `stored`, since that is what pushed it over; on every non-zero field if
 * none changed.
 */
export function countsOverQuantity(
  quantity: number,
  counts: OutOfServiceCounts,
  stored: OutOfServiceCounts,
): Partial<Record<OutOfServiceStatus, string[]>> | null {
  if (outOfServiceTotal(counts) <= quantity) return null;
  const message = `This item has ${quantity} ${quantity === 1 ? 'unit' : 'units'}, so no more than ${quantity} can be out of service in all.`;
  const changed = OUT_OF_SERVICE_STATUSES.filter((status) => counts[status] !== stored[status]);
  const fields = changed.length > 0 ? changed : OUT_OF_SERVICE_STATUSES.filter((status) => counts[status] > 0);
  return Object.fromEntries(fields.map((status) => [status, [message]]));
}

/**
 * The units of an item that can be committed to any event at all, before
 * SCRUM-167 takes off what other events hold:
 * - AC5: none while the item's own status (SCRUM-240) is Unavailable, Damaged
 *   or Under maintenance;
 * - AC1, AC3: otherwise its quantity less every unit out of service, in every
 *   window, with no end date.
 * Never below zero.
 */
export function unitsInService(item: {
  quantity: number;
  operationalStatus: OperationalStatus;
  counts: OutOfServiceCounts;
}): number {
  if (item.operationalStatus !== 'available') return 0;
  return Math.max(item.quantity - outOfServiceTotal(item.counts), 0);
}

/** AC1: "the count is saved against the item with its status", as the catalogue shows it: "2 Damaged, 1 Under maintenance". */
export function describeOutOfService(counts: OutOfServiceCounts): string | null {
  const parts = OUT_OF_SERVICE_STATUSES.filter((status) => counts[status] > 0).map(
    (status) => `${counts[status]} ${OUT_OF_SERVICE_LABELS[status]}`,
  );
  return parts.length > 0 ? parts.join(', ') : null;
}
