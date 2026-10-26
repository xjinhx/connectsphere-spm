import { formatClockRange } from '@/domain/shared/times';
import { ROOM_LAYOUT_LABELS } from '@/domain/venues/schema';
import type { ReviewState, ScheduleValues, SignificantChangeKind } from './schema';

/**
 * SCRUM-111 — which change affects which arrangement, and how the change is
 * described on the flag. Pure, so the coordinator's form lists what a change
 * would affect as it is typed, and the service decides the same thing again
 * on save.
 */

/** AC1: a venue booking is affected by the date, the times, the attendance or the venue requirements (AC5). */
export const VENUE_BOOKING_CHANGES: readonly SignificantChangeKind[] = ['date', 'times', 'attendance', 'requirements'];
/** AC2: an equipment reservation by the date or the times only. */
export const EQUIPMENT_RESERVATION_CHANGES: readonly SignificantChangeKind[] = ['date', 'times'];

/** YYYY-MM-DD as DD/MM/YYYY, the format the team's sheets and the flag use. */
export function formatDayMonthYear(date: string | null): string {
  if (!date) return 'not set';
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

function describeTimes(values: ScheduleValues): string {
  if (!values.startTime || !values.endTime) return 'not set';
  return formatClockRange({ start: values.startTime, end: values.endTime });
}

function describeLayout(values: ScheduleValues): string {
  return values.roomLayout ? ROOM_LAYOUT_LABELS[values.roomLayout] : 'not set';
}

function describeAccessibilityAnswer(values: ScheduleValues): string {
  if (values.accessibilityRequired === null) return 'not answered';
  if (values.accessibilityRequired === false) return 'none required';
  return values.accessibilityNotes ? `required (${values.accessibilityNotes})` : 'required';
}

/** The notes only count with a "yes" (SCRUM-79): that is how they are stored. */
function accessibilityOf(values: ScheduleValues): string {
  return values.accessibilityRequired === true
    ? `yes:${values.accessibilityNotes?.trim() ?? ''}`
    : String(values.accessibilityRequired);
}

/** The significant fields that differ between what is stored and what is being saved. */
export function changedKinds(before: ScheduleValues, after: ScheduleValues): SignificantChangeKind[] {
  const kinds: SignificantChangeKind[] = [];
  if (before.proposedDate !== after.proposedDate) kinds.push('date');
  if (before.startTime !== after.startTime || before.endTime !== after.endTime) kinds.push('times');
  if (before.expectedAttendance !== after.expectedAttendance) kinds.push('attendance');
  if (before.roomLayout !== after.roomLayout || accessibilityOf(before) !== accessibilityOf(after)) {
    kinds.push('requirements');
  }
  return kinds;
}

function describeKind(kind: SignificantChangeKind, before: ScheduleValues, after: ScheduleValues): string {
  switch (kind) {
    case 'date':
      return `Date changed from ${formatDayMonthYear(before.proposedDate)} to ${formatDayMonthYear(after.proposedDate)}`;
    case 'times':
      return `Times changed from ${describeTimes(before)} to ${describeTimes(after)}`;
    case 'attendance':
      return `Expected attendance changed from ${before.expectedAttendance ?? 'not set'} to ${after.expectedAttendance ?? 'not set'}`;
    case 'requirements': {
      const parts: string[] = [];
      if (before.roomLayout !== after.roomLayout) {
        parts.push(`room layout from ${describeLayout(before)} to ${describeLayout(after)}`);
      }
      if (accessibilityOf(before) !== accessibilityOf(after)) {
        parts.push(`accessibility from ${describeAccessibilityAnswer(before)} to ${describeAccessibilityAnswer(after)}`);
      }
      return `Venue requirements changed: ${parts.join('; ')}`;
    }
  }
}

/**
 * AC5: "the change that caused it", for one kind of arrangement: each change
 * that affects it, joined. Null when none does, so the arrangement is not
 * affected (AC3 for a descriptive-only change, which never reaches here with
 * a difference at all).
 */
export function describeChange(
  before: ScheduleValues,
  after: ScheduleValues,
  relevant: readonly SignificantChangeKind[],
): string | null {
  const kinds = changedKinds(before, after).filter((kind) => relevant.includes(kind));
  if (kinds.length === 0) return null;
  return kinds.map((kind) => describeKind(kind, before, after)).join('; ');
}

/** The cause to set on each kind of arrangement; null where that kind is not affected. */
export function changeCauses(before: ScheduleValues, after: ScheduleValues) {
  return {
    booking: describeChange(before, after, VENUE_BOOKING_CHANGES),
    reservation: describeChange(before, after, EQUIPMENT_RESERVATION_CHANGES),
  };
}

/**
 * AC1, AC2, AC3: the arrangements a change would affect. `bookings` are the
 * event's confirmed venue bookings and `reservations` its reserved equipment;
 * a released one is no longer an arrangement.
 */
export function affectedArrangements<B, R>(
  before: ScheduleValues,
  after: ScheduleValues,
  arrangements: { bookings: readonly B[]; reservations: readonly R[] },
): { bookings: B[]; reservations: R[] } {
  const causes = changeCauses(before, after);
  return {
    bookings: causes.booking ? [...arrangements.bookings] : [],
    reservations: causes.reservation ? [...arrangements.reservations] : [],
  };
}

/** AC1, AC2: an acknowledgement is needed exactly when something is affected. */
export function needsAcknowledgement(affected: { bookings: readonly unknown[]; reservations: readonly unknown[] }): boolean {
  return affected.bookings.length > 0 || affected.reservations.length > 0;
}

/** AC8: the event still has an arrangement waiting to be re-confirmed. */
export function eventNeedsReview(arrangements: readonly Pick<ReviewState, 'reviewRequired'>[]): boolean {
  return arrangements.some((arrangement) => arrangement.reviewRequired);
}
