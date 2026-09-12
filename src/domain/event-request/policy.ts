import {
  eventRequestCoreSchema,
  normaliseTimeSlots,
  TIME_SLOT_LABELS,
  TIME_SLOT_ORDER,
  type TimeSlot,
} from './schema';
import {
  isPastDate,
  todayInSingapore,
  toSingaporeISODate,
  type ISODate,
} from '@/domain/shared/dates';

/**
 * SCRUM-78 — State expected attendance.
 * Pure validation, no I/O. Reuses the shared schema's attendance rule so this
 * story and the base event-request story never define the rule twice.
 */
export function validateExpectedAttendance(value: unknown): number {
  return eventRequestCoreSchema.shape.expectedAttendance.parse(value);
}

/**
 * AC4 (US-5.1-TC04): attendance is a single event-level field.
 * This function exists so tests can assert the shape directly — if someone
 * later adds a duplicate `attendance` field inside venue requirements,
 * this check should be extended to guard against it once that shape exists.
 */
export function isAttendanceEventLevelOnly(eventRequest: Record<string, unknown>): boolean {
  const venueRequirements = eventRequest.venueRequirements as
    | Record<string, unknown>
    | undefined;
  return !venueRequirements || !('expectedAttendance' in venueRequirements);
}

// ---------------------------------------------------------------------------
// SCRUM-76 — Create an event request with basic details
// ---------------------------------------------------------------------------

export const PAST_PROPOSED_DATE_MESSAGE = 'The proposed date must be today or later.';

/**
 * SCRUM-76 AC3 and AC4 — the only rule on a proposed date is that it has not
 * already passed. There is deliberately NO minimum lead time: an event a week
 * out, or tomorrow, or later today, is all equally acceptable.
 *
 * "Passed" is judged in Singapore time. Judging it against the server clock
 * would reject a valid date for the eight hours a day that UTC and Singapore
 * disagree about what day it is.
 *
 * This is the rule only. Applying it at submission - and the completeness
 * check that goes with it - is SCRUM-82's, which should call this from there.
 */
export function isProposedDateSubmittable(
  proposedDate: Date,
  today: ISODate = todayInSingapore(),
): boolean {
  return !isPastDate(toSingaporeISODate(proposedDate), today);
}

// ---------------------------------------------------------------------------
// SCRUM-77 — Choose the time slots the event needs
// ---------------------------------------------------------------------------

/**
 * AC2 — all three slots together are a full-day booking requirement. Derived,
 * not stored: a separate "full day" flag would be a second copy of the same
 * fact that could drift from the slots it describes.
 */
export function isFullDay(slots: readonly TimeSlot[]): boolean {
  return normaliseTimeSlots(slots).length === TIME_SLOT_ORDER.length;
}

/** What the request shows for its slots: "Full day", or the slots in day order. */
export function describeTimeSlots(slots: readonly TimeSlot[] | null): string {
  if (!slots || slots.length === 0) return 'Not yet provided';
  if (isFullDay(slots)) return 'Full day';
  return normaliseTimeSlots(slots)
    .map((slot) => TIME_SLOT_LABELS[slot])
    .join(', ');
}
