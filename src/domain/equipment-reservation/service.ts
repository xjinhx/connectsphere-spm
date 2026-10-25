import { z } from 'zod';
import type { OperationalStatus } from '@/domain/equipment/schema';
import { unitsInService } from '@/domain/equipment-out-of-service/policy';
import { canViewEquipmentRequest } from '@/domain/equipment-request/policy';
import type { Role } from '@/domain/identity/roles';
import { ForbiddenError, NotFoundError, UnavailableError, ValidationError } from '@/domain/shared/errors';
import { fetchEventRequestById, type EventRequestRow } from '@/lib/supabase/eventRequests';
import { fetchEquipmentRequestLine } from '@/lib/supabase/equipmentRequests';
import {
  fetchConfirmedBookingDates,
  fetchEventReservations,
  fetchLinesWithItems,
  fetchOtherEventsReservations,
  fetchReservation,
  reserveEquipmentLine,
} from '@/lib/supabase/equipmentReservations';
import {
  availableUnits,
  checkLines,
  commitmentWindow,
  heldOnBusiestDay,
  outstandingLines,
  partialReservationOffer,
} from './policy';
import {
  CHECK_NEEDS_APPROVED_BOOKING_MESSAGE,
  EquipmentAvailabilitySchema,
  EquipmentReservationSchema,
  EventReservationsSchema,
  RESERVE_NEEDS_APPROVED_BOOKING_MESSAGE,
  ReserveEquipmentInputSchema,
  type DateWindow,
  type EquipmentAvailability,
  type EquipmentReservation,
  type EventReservations,
} from './schema';

/**
 * Equipment availability and reservation service.
 *
 * SCRUM-167 Check equipment availability across the full commitment window
 * SCRUM-173 Reserve equipment for the full commitment window and view all
 *           reservations for the event
 *
 * Orchestration only: queries live in src/lib/supabase/equipmentReservations.ts
 * and the rules in policy.ts. The acting account is the signed-in one, passed
 * in by the route or page from getCurrentActor.
 */

type Actor = { userId: string; roles: readonly Role[] };

type LineRow = {
  id: string;
  equipment_id: string;
  quantity: number;
  equipment: {
    name: string;
    quantity: number;
    operational_status: OperationalStatus;
    units_unavailable: number;
    units_damaged: number;
    units_under_maintenance: number;
  } | null;
};

type ReservationRow = {
  id: string;
  line_id: string;
  equipment_id: string;
  quantity: number;
  window_start: string;
  window_end: string;
  status: string;
  created_at: string;
  equipment: { name: string } | null;
};

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

/** 167 AC1, AC3: the event's commitment window, refused when it has no approved venue booking. */
async function readWindow(eventRequestId: string): Promise<DateWindow> {
  const { data, error } = await fetchConfirmedBookingDates(eventRequestId);
  if (error || !data) throw new ValidationError("The event's venue bookings could not be read.", error?.message);
  const window = commitmentWindow(data.map((row) => row.date));
  if (!window) throw new ValidationError(CHECK_NEEDS_APPROVED_BOOKING_MESSAGE);
  return window;
}

async function readReservationRows(eventRequestId: string): Promise<ReservationRow[]> {
  const { data, error } = await fetchEventReservations(eventRequestId);
  if (error || !data) throw new ValidationError("The event's reservations could not be read.", error?.message);
  return data as unknown as ReservationRow[];
}

async function readLineRows(eventRequestId: string): Promise<LineRow[]> {
  const { data, error } = await fetchLinesWithItems(eventRequestId);
  if (error || !data) throw new ValidationError('The equipment request could not be read.', error?.message);
  return data as unknown as LineRow[];
}

/** Units each line holds in reservations still Reserved. */
function reservedByLine(rows: readonly ReservationRow[]): Map<string, number> {
  const reserved = new Map<string, number>();
  for (const row of rows) {
    if (row.status === 'reserved') reserved.set(row.line_id, (reserved.get(row.line_id) ?? 0) + row.quantity);
  }
  return reserved;
}

function toReservation(row: ReservationRow): EquipmentReservation {
  return EquipmentReservationSchema.parse({
    id: row.id,
    lineId: row.line_id,
    equipmentId: row.equipment_id,
    // The foreign key is restrict, so a reservation always has its item.
    equipmentName: row.equipment?.name ?? '',
    quantity: row.quantity,
    window: { start: row.window_start, end: row.window_end },
    status: row.status,
    reservedAt: row.created_at,
  });
}

// -----------------------------------------------------------------------------
// SCRUM-167: the availability check
// -----------------------------------------------------------------------------

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
 * Technical Support Staff run it to reserve; the event's assigned coordinator
 * sees it too, so an item that is not free is reported when they ask for it
 * (SCRUM-173 AC4).
 */
export async function checkEquipmentAvailability(eventRequestId: string, actor: Actor): Promise<EquipmentAvailability> {
  const event = await readEventForView(eventRequestId, actor);
  const window = await readWindow(event.id);
  const lines = await readLineRows(event.id);
  const reserved = reservedByLine(await readReservationRows(event.id));

  // SCRUM-170 AC1, AC5: only units in service can be available at all.
  const itemQuantities = new Map(
    lines.map((line) => [
      line.equipment_id,
      line.equipment
        ? unitsInService({
            quantity: line.equipment.quantity,
            operationalStatus: line.equipment.operational_status,
            counts: {
              unavailable: line.equipment.units_unavailable,
              damaged: line.equipment.units_damaged,
              underMaintenance: line.equipment.units_under_maintenance,
            },
          })
        : 0,
    ]),
  );
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

// -----------------------------------------------------------------------------
// SCRUM-173: reserving, and the event's equipment section
// -----------------------------------------------------------------------------

function quantityError(message: string): ValidationError {
  return new ValidationError(message, { formErrors: [], fieldErrors: { quantity: [message] } });
}

/**
 * SCRUM-173: reserves `quantity` units of one line's item for the event's
 * whole commitment window.
 *
 * AC1 enough available: the reservation is created for the window and the
 *     quantity.
 * AC2 no approved venue booking: refused, nothing reserved.
 * AC3 it holds F-1 to L, both included.
 * AC4 an item reserved for a morning event is not available to an afternoon
 *     event that date: refused, nothing reserved.
 * AC5 no cap on the window's length.
 *
 * SCRUM-175 Prevent reserving more than is available: a quantity above what
 * is available is refused, nothing reserved (AC1, AC3), with how many are
 * available and the part that can be reserved instead (partialReservationOffer;
 * none when nothing is available). Reserving exactly what is available
 * succeeds (AC2).
 *
 * Technical Support Staff only (equipment_administration), checked by the
 * route. Reserving again on the same line adds to its reservation, up to what
 * the line asks for.
 */
export async function reserveEquipment(
  eventRequestId: string,
  lineId: string,
  actorId: string,
  input: unknown,
): Promise<EquipmentReservation> {
  const event = await readEvent(eventRequestId);
  const id = z.string().uuid().safeParse(lineId);
  if (!id.success) throw new NotFoundError('Equipment line');

  const { data: line, error: lineError } = await fetchEquipmentRequestLine(event.id, id.data);
  if (lineError) throw new ValidationError('The equipment line could not be read.', lineError.message);
  if (!line) throw new NotFoundError('Equipment line');

  const parsed = ReserveEquipmentInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'The quantity is not valid.', parsed.error.flatten());
  }

  const { data, error } = await reserveEquipmentLine(id.data, parsed.data.quantity, actorId);
  if (error || !data) throw new ValidationError('The equipment could not be reserved.', error?.message);

  const result = data as { outcome: string; available?: number; outstanding?: number; reservationId?: string };
  switch (result.outcome) {
    case 'not_found':
      throw new NotFoundError('Equipment line');
    case 'no_approved_booking':
      throw new ValidationError(RESERVE_NEEDS_APPROVED_BOOKING_MESSAGE);
    case 'more_than_outstanding':
      throw quantityError(
        result.outstanding === 0
          ? 'This line is already fully reserved.'
          : `Only ${result.outstanding} still to reserve on this line.`,
      );
    case 'not_enough_available': {
      // SCRUM-175: nothing is reserved for the quantity asked. AC1: told how
      // many are available and offered those, with the shortfall; AC3: with
      // none available, refused as unavailable and nothing offered.
      const available = result.available ?? 0;
      throw new UnavailableError(
        available === 0
          ? "This item is unavailable for the event's window."
          : `Only ${available} available for the event's window.`,
        { available, offer: partialReservationOffer(parsed.data.quantity, available) },
      );
    }
    case 'reserved': {
      const { data: row, error: readError } = await fetchReservation(result.reservationId ?? '');
      if (readError || !row) throw new ValidationError('The reservation could not be read back.', readError?.message);
      return toReservation(row as unknown as ReservationRow);
    }
    default:
      throw new ValidationError('The equipment could not be reserved.', result);
  }
}

/**
 * SCRUM-173 AC6, AC7: the event's equipment section.
 *
 * AC6 every reservation with its item, quantity, window and status (Reserved,
 *     or Released once SCRUM-177 releases one).
 * AC7 the lines still to reserve, on their own, with how many.
 *
 * Read with no approved venue booking too: nothing is reserved then, and the
 * whole request is outstanding.
 */
export async function listEventReservations(eventRequestId: string, actor: Actor): Promise<EventReservations> {
  const event = await readEventForView(eventRequestId, actor);
  const rows = await readReservationRows(event.id);
  const reserved = reservedByLine(rows);
  const lines = await readLineRows(event.id);

  return EventReservationsSchema.parse({
    eventRequestId: event.id,
    reservations: rows.map(toReservation),
    outstanding: outstandingLines(
      lines.map((line) => ({
        lineId: line.id,
        equipmentName: line.equipment?.name ?? '',
        requested: line.quantity,
        reserved: reserved.get(line.id) ?? 0,
      })),
    ),
  });
}
