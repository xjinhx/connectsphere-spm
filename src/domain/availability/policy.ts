import type { OperatingSlot } from '@/domain/venues/schema';
import { formatSingaporeDate, type ISODate } from '@/domain/shared/dates';
import { SLOT_NAMES } from './schema';

/**
 * Venue availability rules. Pure functions: no Supabase, no Next.js.
 */

/**
 * SCRUM-151 AC1: only a slot the venue operates can be withdrawn. A slot it
 * does not operate is never offered in the first place (SCRUM-116 AC4), so
 * marking it unavailable would record nothing real. CONTEXT.md keeps the two
 * apart: "not operating" is a permanent setting, "unavailable" is one date.
 *
 * Returns the chosen slots the venue does not operate, in the order chosen.
 */
export function findNonOperatingSlots(
  chosen: readonly OperatingSlot[],
  operating: readonly OperatingSlot[],
): OperatingSlot[] {
  return chosen.filter((slot) => !operating.includes(slot));
}

/**
 * SCRUM-151 AC2: what the coordinator of an affected booking is told: which of
 * the booking's slots were withdrawn, and why.
 */
export function affectedBookingMessage(
  venueName: string,
  date: ISODate,
  slots: readonly OperatingSlot[],
  reason: string,
): string {
  const names = slots.map((slot) => SLOT_NAMES[slot]).join(' + ');
  return `Your booking at ${venueName} is affected: ${formatSingaporeDate(date)} ${names} is no longer available (${reason}).`;
}
