import { datesInRange } from '@/domain/venues/policy';
import type { AvailabilityLine, DateWindow, OutstandingLine } from './schema';

/**
 * Equipment availability and reservation rules (SCRUM-167, SCRUM-173). Pure
 * functions: no Supabase, no Next.js.
 *
 * reserve_equipment (supabase/migrations/20261022011508_reserve_equipment.sql)
 * applies the window and busiest-day rules again inside the write, with the
 * item locked, so the check and the reservation agree.
 */

/** A YYYY-MM-DD date moved by whole days. */
export function addDays(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/**
 * 167 AC1, 173 AC3: "F-1 to L inclusive, free again from L+1". F and L are the
 * first and last dates of the event's confirmed venue bookings, in any order;
 * equipment is collected the day before F and comes back on L (Return Day).
 *
 * Null when there are none: 167 AC3 and 173 AC2 refuse an event with no
 * approved venue booking.
 */
export function commitmentWindow(bookingDates: readonly string[]): DateWindow | null {
  if (bookingDates.length === 0) return null;
  const sorted = [...bookingDates].sort();
  return { start: addDays(sorted[0]!, -1), end: sorted[sorted.length - 1]! };
}

/** A reservation as the rules read it: how many units, over which days. */
export type HeldUnits = { quantity: number; window: DateWindow };

/**
 * 167 AC5, AC6, AC9: the most units held on any one day of `window`. Given
 * other events' reservations only: the event's own are not counted against it
 * (167 AC4).
 *
 * - AC5: a reservation sharing even one day with the window reduces what is
 *   available.
 * - AC6: whole days, so a morning and an afternoon event on the same date
 *   share it.
 * - AC9 (PO, CL-38): reservations on different days of the window are counted
 *   against the busiest single day, not summed: 4 held only on the first day
 *   and 4 only on the last take 4, not 8.
 */
export function heldOnBusiestDay(held: readonly HeldUnits[], window: DateWindow): number {
  let busiest = 0;
  for (const day of datesInRange(window.start, window.end)) {
    const onDay = held
      .filter((units) => units.window.start <= day && day <= units.window.end)
      .reduce((sum, units) => sum + units.quantity, 0);
    busiest = Math.max(busiest, onDay);
  }
  return busiest;
}

/**
 * 167 Definitions (CL-46): "the item's quantity, minus units out of service
 * (SCRUM-170), minus the highest number of units committed to other events on
 * any single day of the window". Never below 0 (SCRUM-170 AC6). The caller
 * passes the item's units in service (SCRUM-170's unitsInService), so units
 * out of service are already off.
 */
export function availableUnits(unitsInService: number, othersOnBusiestDay: number): number {
  return Math.max(unitsInService - othersOnBusiestDay, 0);
}

/** One line of the event's request, with how much of it has been reserved. */
export type CheckedLine = {
  lineId: string;
  equipmentId: string;
  equipmentName: string;
  requested: number;
  alreadyReserved: number;
};

/**
 * 167 AC4: each line with requested, already reserved, available and
 * shortfall.
 *
 * `availableByItem` is availableUnits for each item: other events' units
 * taken off, this event's own not, so units it has already reserved are part
 * of what is available to it (TC-167-06: requested 6, 4 reserved, 10
 * available, shortfall 0).
 *
 * Two lines of the same item (SCRUM-160 AC3 keeps them apart) share what is
 * available, in the order they were added, so the same units are never
 * promised to both.
 */
export function checkLines(
  lines: readonly CheckedLine[],
  availableByItem: ReadonlyMap<string, number>,
): AvailabilityLine[] {
  const left = new Map(availableByItem);
  return lines.map((line) => {
    const available = availableByItem.get(line.equipmentId) ?? 0;
    const covered = Math.min(line.requested, left.get(line.equipmentId) ?? 0);
    left.set(line.equipmentId, (left.get(line.equipmentId) ?? 0) - covered);
    return { ...line, available, shortfall: line.requested - covered };
  });
}

/**
 * 173 AC7: "outstanding quantities shown separately". The lines with units
 * still to reserve, and how many; a fully reserved line is left out.
 */
export function outstandingLines(
  lines: readonly { lineId: string; equipmentName: string; requested: number; reserved: number }[],
): OutstandingLine[] {
  return lines
    .filter((line) => line.requested > line.reserved)
    .map((line) => ({ ...line, outstanding: line.requested - line.reserved }));
}
