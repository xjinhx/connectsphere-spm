import { z } from 'zod';
import { canViewEquipmentRequest } from '@/domain/equipment-request/policy';
import type { Role } from '@/domain/identity/roles';
import { ForbiddenError, NotFoundError, ValidationError } from '@/domain/shared/errors';
import { fetchEventRequestById, type EventRequestRow } from '@/lib/supabase/eventRequests';
import {
  fetchConfirmedBookingDates,
  fetchEventReservations,
  fetchLinesWithItems,
  fetchOtherEventsReservations,
} from '@/lib/supabase/equipmentReservations';
import { availableUnits, checkLines, commitmentWindow, heldOnBusiestDay } from './policy';
import {
  CHECK_NEEDS_APPROVED_BOOKING_MESSAGE,
  EquipmentAvailabilitySchema,
  type DateWindow,
  type EquipmentAvailability,
} from './schema';

/**
 * Equipment availability service.
 *
 * SCRUM-167 Check equipment availability across the full commitment window
 *
 * Orchestration only: queries live in src/lib/supabase/equipmentReservations.ts
 * and the rules in policy.ts. The acting account is the signed-in one, passed
 * in by the route or page from getCurrentActor.
 */

type Actor = { userId: string; roles: readonly Role[] };

type LineRow = { id: string; equipment_id: string; quantity: number; equipment: { name: string; quantity: number } | null };

type ReservationRow = { line_id: string; quantity: number; status: string };

const VIEW_REFUSED_MESSAGE =
  "Only Technical Support Staff and the event's assigned coordinator can view its equipment.";

async function readEvent(eventRequestId: string): Promise<EventRequestRow> {
  const id = z.string().uuid().safeParse(eventRequestId);
  if (!id.success) throw new NotFoundError('Event request');

  const { data, error } = await fetchEventRequestById(id.data);
  if (error) throw new ValidationError('The event request could not be read.', error.message);
  if (!data) throw new NotFoundError('Event request');
  return data as unknown as EventRequestRow;
}

/**
 * The event, refused unless `actor` may see its equipment: Technical Support
 * Staff, or the event's assigned coordinator - the same people who may open
 * its equipment request (SCRUM-160's canViewEquipmentRequest).
 */
async function readEventForView(eventRequestId: string, actor: Actor): Promise<EventRequestRow> {
  const event = await readEvent(eventRequestId);
  if (!canViewEquipmentRequest(actor, event.coordinator_id)) throw new ForbiddenError(VIEW_REFUSED_MESSAGE);
  return event;
}

/** AC1, AC3: the event's commitment window, refused when it has no approved venue booking. */
async function readWindow(eventRequestId: string): Promise<DateWindow> {
  const { data, error } = await fetchConfirmedBookingDates(eventRequestId);
  if (error || !data) throw new ValidationError("The event's venue bookings could not be read.", error?.message);
  const window = commitmentWindow(data.map((row) => row.date));
  if (!window) throw new ValidationError(CHECK_NEEDS_APPROVED_BOOKING_MESSAGE);
  return window;
}

async function readLineRows(eventRequestId: string): Promise<LineRow[]> {
  const { data, error } = await fetchLinesWithItems(eventRequestId);
  if (error || !data) throw new ValidationError('The equipment request could not be read.', error?.message);
  return data as unknown as LineRow[];
}

/** AC4: units each of the event's lines already holds, in reservations still Reserved. */
async function readReservedByLine(eventRequestId: string): Promise<Map<string, number>> {
  const { data, error } = await fetchEventReservations(eventRequestId);
  if (error || !data) throw new ValidationError("The event's reservations could not be read.", error?.message);
  const reserved = new Map<string, number>();
  for (const row of data as unknown as ReservationRow[]) {
    if (row.status === 'reserved') reserved.set(row.line_id, (reserved.get(row.line_id) ?? 0) + row.quantity);
  }
  return reserved;
}

/**
 * SCRUM-167: every line of the event's equipment request, checked over its
 * commitment window.
 *
 * AC1 the window is F-1 to L; a reservation from L+1 on is not counted.
 * AC2, AC8 a unit held on F-1 (another event's Return Day) is not available.
 * AC3 an event with no approved venue booking is refused, nothing checked.
 * AC4 each line shows requested, already reserved, available and shortfall;
 *     the event's own reservations are not counted against it.
 * AC5, AC6 another event's reservation sharing any day of the window counts,
 *     whatever time of day either event runs.
 * AC7 a Return Day at least one day before collection does not count.
 * AC9 reservations on different days count against the busiest day.
 *
 * Technical Support Staff run it; the event's assigned coordinator sees it too,
 * so an item that is not free shows as unavailable when they ask for it.
 */
export async function checkEquipmentAvailability(eventRequestId: string, actor: Actor): Promise<EquipmentAvailability> {
  const event = await readEventForView(eventRequestId, actor);
  const window = await readWindow(event.id);
  const lines = await readLineRows(event.id);
  const reserved = await readReservedByLine(event.id);

  const itemQuantities = new Map(lines.map((line) => [line.equipment_id, line.equipment?.quantity ?? 0]));
  const held = new Map<string, { quantity: number; window: DateWindow }[]>();
  if (itemQuantities.size > 0) {
    const { data, error } = await fetchOtherEventsReservations(event.id, [...itemQuantities.keys()], window);
    if (error || !data) throw new ValidationError('The equipment reservations could not be read.', error?.message);
    for (const row of data) {
      const list = held.get(row.equipment_id) ?? [];
      list.push({ quantity: row.quantity, window: { start: row.window_start, end: row.window_end } });
      held.set(row.equipment_id, list);
    }
  }

  const availableByItem = new Map(
    [...itemQuantities].map(([itemId, quantity]) => [
      itemId,
      availableUnits(quantity, heldOnBusiestDay(held.get(itemId) ?? [], window)),
    ]),
  );

  return EquipmentAvailabilitySchema.parse({
    eventRequestId: event.id,
    window,
    lines: checkLines(
      lines.map((line) => ({
        lineId: line.id,
        equipmentId: line.equipment_id,
        // The foreign key is restrict, so a line always has its catalogue item.
        equipmentName: line.equipment?.name ?? '',
        requested: line.quantity,
        alreadyReserved: reserved.get(line.id) ?? 0,
      })),
      availableByItem,
    ),
  });
}
