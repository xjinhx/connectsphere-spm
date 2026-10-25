import { EVENT_REQUEST_STATUS_LABELS, type EventRequestStatus } from '@/domain/event-request/schema';
import { formatDayMonthYear } from '@/domain/shared/dates';
import { ARRANGEMENTS, type Arrangement, type ArrangementNeeds, type ConfirmationSnapshot, type VenuePeriod } from './schema';

/**
 * SCRUM-100 — Record which arrangements are essential for an event.
 * Pure rules only; service.ts applies them.
 */

/**
 * AC1: the set can be recorded while the event is Approved or in Planning.
 * AC3: a Confirmed event refuses a change until it is returned to Planning,
 * and so does every other status (TC-100-04).
 *
 * Restated in SQL by record_essential_arrangements
 * (20261018150054_event_essential_arrangements.sql), which checks it again with
 * the event row locked; change one, change the other.
 */
export function canChangeEssentialArrangements(status: EventRequestStatus): boolean {
  return status === 'approved' || status === 'planning';
}

export const CONFIRMED_REFUSAL =
  'This event is Confirmed. Return it to Planning before changing its essential arrangements.';

/** Why a status refuses a change, or null when it allows one. */
export function essentialArrangementsRefusal(status: EventRequestStatus): string | null {
  if (canChangeEssentialArrangements(status)) return null;
  if (status === 'confirmed') return CONFIRMED_REFUSAL;
  return (
    'Essential arrangements can only be recorded while an event is Approved or in Planning. ' +
    `This event is ${EVENT_REQUEST_STATUS_LABELS[status]}.`
  );
}

/** Before anything is recorded, nothing is essential (AC2, TC-100-05). */
export const NO_ARRANGEMENTS_RECORDED: ArrangementNeeds = {
  venue: 'not_required',
  equipment: 'not_required',
  technicalSupport: 'not_required',
  registration: 'not_required',
};

/** The arrangements marked essential, in card order. */
export function essentialArrangementsIn(needs: ArrangementNeeds): Arrangement[] {
  return ARRANGEMENTS.filter((arrangement) => needs[arrangement] === 'essential');
}

/** AC2's wording, shown when no arrangement is marked essential. */
export const NO_OUTSTANDING_ESSENTIAL_ARRANGEMENTS = 'No outstanding essential arrangements.';

// -----------------------------------------------------------------------------
// SCRUM-102 — Block confirmation until essential arrangements are complete
// -----------------------------------------------------------------------------

export const CANNOT_CONFIRM_YET = "This event can't be confirmed yet. Still outstanding:";
export const NO_APPROVED_BOOKING = 'Venue: no venue booking has been approved.';
export const NO_EQUIPMENT_REQUESTED = 'Equipment: no equipment has been requested.';

const byDateThenStart = (a: VenuePeriod, b: VenuePeriod) =>
  a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime);

const describePeriod = (period: VenuePeriod) =>
  `${period.venueName}, ${formatDayMonthYear(period.date)}, ${period.startTime} to ${period.endTime}`;

/**
 * Each essential arrangement that is not complete (CONTEXT.md), one line each,
 * all of them rather than the first (AC1, AC2, TC-102-07). Empty means the
 * event can be confirmed (AC3, AC4). An arrangement not marked essential is
 * never named, however incomplete: it is an outstanding action that stays open
 * after confirmation (AC5, CL-56).
 *
 * Venue: each Pending line and each affected booking is named. With neither,
 * and no confirmed booking either, the venue has no approved booking. Rejected
 * lines and released bookings count for nothing either way.
 *
 * Equipment: each line still to reserve is named (SCRUM-173's outstanding
 * lines). Essential with nothing requested is not complete: no lines at all is
 * no line outstanding and no reservation held.
 *
 * Technical support and registration are never named. Nothing records either
 * as done, and registration is only set up once the event is Confirmed
 * (SCRUM-185 AC5), so an event with either marked essential could otherwise
 * never be confirmed. No AC of this story covers them.
 */
export function outstandingEssentialArrangements(snapshot: ConfirmationSnapshot): string[] {
  const outstanding: string[] = [];

  if (snapshot.needs.venue === 'essential') {
    const pending = snapshot.venueLines.filter((line) => line.status === 'pending').sort(byDateThenStart);
    const confirmed = snapshot.venueBookings.filter((booking) => booking.status === 'confirmed').sort(byDateThenStart);
    const affected = new Set(snapshot.affectedBookings.map((booking) => booking.bookingId));

    for (const line of pending) outstanding.push(`Venue: ${describePeriod(line)} is not yet approved.`);
    for (const booking of confirmed.filter((candidate) => affected.has(candidate.id))) {
      outstanding.push(`Venue: ${describePeriod(booking)} is affected by an unavailable period.`);
    }
    if (pending.length === 0 && confirmed.length === 0) outstanding.push(NO_APPROVED_BOOKING);
  }

  if (snapshot.needs.equipment === 'essential') {
    const { reservations, outstanding: toReserve } = snapshot.equipment;
    if (toReserve.length === 0 && !reservations.some((reservation) => reservation.status === 'reserved')) {
      outstanding.push(NO_EQUIPMENT_REQUESTED);
    }
    for (const line of toReserve) outstanding.push(`Equipment: ${line.equipmentName}, ${line.outstanding} still to reserve.`);
  }

  return outstanding;
}

/** The refusal: every outstanding arrangement, one per line (TC-102-07). */
export function confirmationRefusal(outstanding: readonly string[]): string {
  return [CANNOT_CONFIRM_YET, ...outstanding.map((line) => `- ${line}`)].join('\n');
}
