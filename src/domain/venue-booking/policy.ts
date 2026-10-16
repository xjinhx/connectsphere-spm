import type { EventRequestStatus } from '@/domain/event-request/schema';
import { isActionPermitted } from '@/domain/identity/permissions';
import type { Role } from '@/domain/identity/roles';
import { formatSingaporeDate } from '@/domain/shared/dates';
import { formatClockRange, rangesOverlap, type ClockRange, type ClockTime } from '@/domain/shared/times';
import { isWithinOpeningHours, type SetupTurnaround } from '@/domain/venues/policy';
import type { CommittedPeriod, VenueCommitment } from '@/domain/availability/schema';
import { formatExpiry } from '@/domain/venue-hold/policy';
import type {
  EventVenueRequirements,
  OwnVenueRequirements,
  VenueBookingRequestLineStatus,
  VenueBookingRequestStatus,
  VenueRequirementsInUse,
} from './schema';
import { describeAccessibility } from '@/domain/event-request/policy';
import { ROOM_LAYOUT_LABELS, RoomLayoutSchema } from '@/domain/venues/schema';

/**
 * SCRUM-142 — Submit a venue booking request for an event.
 *
 * AC1 (Jira, updated 29/9/2026): "Given I am the assigned coordinator of an
 * event that is Approved or in Planning, when I submit a booking request...
 * then the request is created with status Pending...". This is now the
 * confirmed card text, not an inference.
 *
 * Scope note (also confirmed 29/9/2026): this ticket's job stops at
 * creating the Pending request — it does not cover how the resulting status
 * is displayed (SCRUM-99, "See the current status of an event") or the
 * Venue Staff-facing queue page itself (SCRUM-147, "View the pending booking
 * request queue"). Both are separate tickets; this one only needs the row to
 * exist and be readable by that role.
 */
export function canCreateBookingRequest(status: EventRequestStatus): boolean {
  return status === 'approved' || status === 'planning';
}

// ---------------------------------------------------------------------------
// SCRUM-239 AC1, AC3, AC8 — refuse a request that is outside the venue's
// opening hours or overlaps a committed period. SCRUM-154's rules, carried
// into time ranges (SCRUM-154 stays Done on slots).
// ---------------------------------------------------------------------------

/** "10 Nov 2026 11:00–13:00". */
export function describePeriod(period: { date: string } & ClockRange): string {
  return `${formatSingaporeDate(period.date)} ${formatClockRange(period)}`;
}

/**
 * AC1: a requested period that starts before the venue opens or ends after it
 * closes. The same rule search uses (isWithinOpeningHours, Part 1), so a venue
 * search leaves out is never one a request accepts, and the other way round.
 * SCRUM-226: the venue's setup and turnaround must fit inside the hours too.
 */
export function isOutsideOpeningHours(
  period: ClockRange,
  hours: { opensAt: ClockTime; closesAt: ClockTime },
  times?: SetupTurnaround,
): boolean {
  return !isWithinOpeningHours(period, hours, times);
}

/**
 * AC1: "Outside this venue's opening hours (08:00–22:00)." SCRUM-226 adds
 * what had to fit as well, so the coordinator sees why 08:00 is refused at a
 * venue opening at 08:00: "..., including its 30-minute setup."
 */
export function outsideOpeningHoursMessage(
  hours: { opensAt: ClockTime; closesAt: ClockTime },
  times: SetupTurnaround = { setupMinutes: 0, turnaroundMinutes: 0 },
): string {
  const parts = [
    ...(times.setupMinutes > 0 ? [`${times.setupMinutes}-minute setup`] : []),
    ...(times.turnaroundMinutes > 0 ? [`${times.turnaroundMinutes}-minute turnaround`] : []),
  ];
  const including = parts.length > 0 ? `, including its ${parts.join(' and ')}` : '';
  return `Outside this venue's opening hours (${formatClockRange({ start: hours.opensAt, end: hours.closesAt })})${including}.`;
}

/**
 * Two lines of one request asking for overlapping periods on the same date:
 * the second of each pair, by position. They could never both be booked, so
 * the request is refused before anything is written.
 */
export function overlappingLines(lines: readonly ({ date: string } & ClockRange)[]): number[] {
  return lines.flatMap((line, index) =>
    lines.slice(0, index).some((earlier) => earlier.date === line.date && rangesOverlap(earlier, line)) ? [index] : [],
  );
}

export const OVERLAPPING_LINES_MESSAGE = 'Overlaps another period on the same date in this request.';

/**
 * AC3, AC8: one requested line that overlaps committed periods, with the
 * periods only: no event, organiser, client or reason (AC3: "without any
 * other event's details").
 */
export interface PeriodClash {
  /** The line's position in the request, so the form can show the clash beside it. */
  lineIndex: number;
  date: string;
  start: string;
  end: string;
  committed: CommittedPeriod[];
}

function listPeriods(periods: readonly ClockRange[]): string {
  const ranges = periods.map(formatClockRange);
  return ranges.length > 1 ? `${ranges.slice(0, -1).join(', ')} and ${ranges[ranges.length - 1]}` : (ranges[0] ?? '');
}

/**
 * AC3, AC8: the refusal the coordinator reads. Each requested period that
 * clashes, and the committed period it clashes with:
 * "This venue cannot be requested for that time. 10 Nov 2026 11:00–13:00
 * clashes with 10:00–12:00, which is already committed."
 */
export function describePeriodClashes(clashes: readonly PeriodClash[]): string {
  const parts = clashes.map(
    (clash) =>
      `${describePeriod(clash)} clashes with ${listPeriods(clash.committed)}, which ${clash.committed.length > 1 ? 'are' : 'is'} already committed`,
  );
  return `This venue cannot be requested for that time. ${parts.join('. ')}.`;
}

/** What the form shows beside the clashing line's times. */
export function periodClashFieldMessage(clash: PeriodClash): string {
  return `Clashes with ${listPeriods(clash.committed)}, already committed.`;
}

// ---------------------------------------------------------------------------
// SCRUM-148 — Approve a booking request
// ---------------------------------------------------------------------------

/**
 * AC1 and AC5: a request's status from its lines' decisions.
 *
 * Any line still pending: Pending. Every line approved: Approved (AC1). Every
 * line rejected: Rejected. A mix: Partially Approved (AC5).
 */
export function requestStatusOf(lineStatuses: readonly VenueBookingRequestLineStatus[]): VenueBookingRequestStatus {
  if (lineStatuses.length === 0 || lineStatuses.includes('pending')) return 'pending';
  if (lineStatuses.every((status) => status === 'approved')) return 'approved';
  if (lineStatuses.every((status) => status === 'rejected')) return 'rejected';
  return 'partially_approved';
}

/**
 * AC3 and AC4: who sees a booked slot's event on the venue calendar.
 *
 * Venue Staff (venue_administration), Event Operations Managers
 * (coordinator_assignment) and the event's own assigned coordinator see the
 * event (AC3). Every other internal user sees only that the slot is committed
 * (AC4). The same "role and relationship to the event" rule as customer
 * clarification #91 and the review reads.
 */
export function canSeeBookingDetails(
  actor: { userId: string; roles: readonly Role[] },
  eventCoordinatorId: string | null,
): boolean {
  return (
    isActionPermitted(actor.roles, 'venue_administration') ||
    isActionPermitted(actor.roles, 'coordinator_assignment') ||
    (eventCoordinatorId !== null && eventCoordinatorId === actor.userId)
  );
}

/**
 * AC2: what the event's coordinator is told when their booking request is
 * decided: the outcome, the dates and periods, and each rejected line's reason.
 */
export function bookingDecisionMessage(
  venueName: string,
  decision: {
    status: VenueBookingRequestStatus;
    lines: readonly ({
      date: string;
      status: VenueBookingRequestLineStatus;
      rejectionReason: string | null;
    } & ClockRange)[];
  },
): string {
  const when = describePeriod;
  const approved = decision.lines.filter((line) => line.status === 'approved').map(when);
  const rejected = decision.lines
    .filter((line) => line.status === 'rejected')
    .map((line) => `${when(line)} (${line.rejectionReason ?? ''})`);
  const request = `Your booking request for ${venueName}`;
  if (rejected.length === 0) return `${request} was approved: ${approved.join(', ')}.`;
  if (approved.length === 0) return `${request} was rejected: ${rejected.join('; ')}.`;
  return `${request} was partially approved. Approved: ${approved.join(', ')}. Rejected: ${rejected.join('; ')}.`;
}

// ---------------------------------------------------------------------------
// SCRUM-147 — View the pending booking request queue
// ---------------------------------------------------------------------------

export const BOOKING_QUEUE_SORTS = ['requested', 'event-date'] as const;
export type BookingQueueSort = (typeof BOOKING_QUEUE_SORTS)[number];

/** A sort named in the URL, or the default when it is missing or unknown. */
export function toBookingQueueSort(value: unknown): BookingQueueSort {
  return BOOKING_QUEUE_SORTS.find((sort) => sort === value) ?? 'requested';
}

/**
 * The order the queue is shown in.
 *
 * 'requested' (the default; the card sets none): the oldest request first, so
 *   Venue Staff work through requests in the order they arrived.
 * 'event-date' (AC2): the soonest requested event date first. Dates are
 *   compared as YYYY-MM-DD strings, which order the same way as the calendar,
 *   never as displayed text ("2 Jan 2027" would sort before "30 Dec 2026").
 *
 * Ties fall back to the other order, then the line id, so the result is stable.
 * Returns a new array; the input is not reordered in place.
 */
export function sortBookingQueue<T extends { lineId: string; date: string; requestedAt: string }>(
  entries: readonly T[],
  sort: BookingQueueSort,
): T[] {
  const byRequestedAt = (a: T, b: T) => Date.parse(a.requestedAt) - Date.parse(b.requestedAt);
  const byDate = (a: T, b: T) => a.date.localeCompare(b.date);
  const byLine = (a: T, b: T) => a.lineId.localeCompare(b.lineId);
  const order: Record<BookingQueueSort, (a: T, b: T) => number> = {
    requested: (a, b) => byRequestedAt(a, b) || byDate(a, b) || byLine(a, b),
    'event-date': (a, b) => byDate(a, b) || byRequestedAt(a, b) || byLine(a, b),
  };
  return [...entries].sort(order[sort]);
}

// ---------------------------------------------------------------------------
// SCRUM-143 — Include the requirements Venue Staff need
// ---------------------------------------------------------------------------
// AC2: attendance, layout and accessibility needs are shown as recorded on the
// event. AC4: a layout or accessibility need that was never recorded reads
// "Not specified", never a blank. A recorded "no accessibility needs" is an
// answer, so it reads "None required" (AC2), not "Not specified".

export const NOT_SPECIFIED = 'Not specified';

/** AC2, AC4 — the event's expected attendance. */
export function describeAttendanceForVenueStaff(expectedAttendance: number | null): string {
  return expectedAttendance === null ? NOT_SPECIFIED : String(expectedAttendance);
}

/** AC2, AC4 — the event's required layout, in the catalogue's own words. */
export function describeLayoutForVenueStaff(roomLayout: string | null): string {
  const layout = RoomLayoutSchema.safeParse(roomLayout);
  return layout.success ? ROOM_LAYOUT_LABELS[layout.data] : NOT_SPECIFIED;
}

/** AC2, AC4 — the event's accessibility needs: the features and notes, "None required", or not specified. */
export function describeAccessibilityForVenueStaff(event: {
  accessibilityRequired: boolean | null;
  accessibilityFeatures: readonly { name: string }[];
  accessibilityNotes: string | null;
}): string {
  return event.accessibilityRequired === null ? NOT_SPECIFIED : describeAccessibility(event);
}

// ---------------------------------------------------------------------------
// SCRUM-230 — Give each venue booking its own attendance and requirements
// ---------------------------------------------------------------------------

/** AC2: one venue requirement, the request's own or else the event's, and which it was. */
export function ownOrEvent<T>(own: T | null, event: T | null): { value: T | null; fromEvent: boolean } {
  return own === null ? { value: event, fromEvent: true } : { value: own, fromEvent: false };
}

/**
 * AC2: a request goes by its own venue requirements, and by the event's for
 * any it left empty, field by field. The request page shows them (AC2, AC3),
 * and SCRUM-120's capacity check and SCRUM-135/136's suitability check read
 * the same answer from here rather than each doing its own fallback.
 */
export function venueRequirementsOf(own: OwnVenueRequirements, event: EventVenueRequirements): VenueRequirementsInUse {
  return {
    expectedAttendance: ownOrEvent(own.expectedAttendance, event.expectedAttendance),
    roomLayout: ownOrEvent(own.roomLayout, event.roomLayout),
    accessibility:
      own.accessibilityRequired === null
        ? {
            required: event.accessibilityRequired,
            features: event.accessibilityFeatures,
            notes: event.accessibilityNotes,
            fromEvent: true,
          }
        : { required: own.accessibilityRequired, features: [], notes: own.accessibilityNotes, fromEvent: false },
  };
}

/**
 * AC2: a value taken from the event is "shown as the event's". One the event
 * never recorded reads "Not specified" alone (SCRUM-143 AC4).
 */
export function markIfEvents(description: string, requirement: { fromEvent: boolean }): string {
  return requirement.fromEvent && description !== NOT_SPECIFIED ? `${description} (event's)` : description;
}

// ---------------------------------------------------------------------------
// SCRUM-149 — Reject a booking request with a reason
// ---------------------------------------------------------------------------

/**
 * AC3: who may open a booking request and see its decision. Venue Staff
 * (venue_administration), who decide it, and the event's assigned coordinator,
 * who sees the reason and the deciding staff member. The card names nobody
 * else.
 */
export function canViewBookingRequest(
  actor: { userId: string; roles: readonly Role[] },
  eventCoordinatorId: string | null,
): boolean {
  return (
    isActionPermitted(actor.roles, 'venue_administration') ||
    (eventCoordinatorId !== null && eventCoordinatorId === actor.userId)
  );
}

// ---------------------------------------------------------------------------
// SCRUM-155 — Block approval of a conflicting booking
// ---------------------------------------------------------------------------

/** AC4: the reason a competing request's line is rejected with (also in the database function). */
export const PERIOD_COMMITTED_REASON = 'This period is committed to another event.';

type EventName = { reference: string; name: string };

/**
 * SCRUM-239 AC4 (SCRUM-155 AC1 and AC5 in time ranges): what one line being
 * approved clashes with. Venue Staff see which event holds a booked or held
 * period (SCRUM-155 AC1) and why a period is unavailable (AC5). `start` and
 * `end` are the clashing period's times, not the line's.
 */
export type ApprovalConflict =
  | ({ lineId: string; date: string; kind: 'booked'; event: EventName | null } & ClockRange)
  | ({ lineId: string; date: string; kind: 'held'; event: EventName | null; expiresAt: string | null } & ClockRange)
  | ({ lineId: string; date: string; kind: 'unavailable'; reason: string } & ClockRange)
  | ({ lineId: string; date: string; kind: 'non_adjacent_slots' } & ClockRange);

/**
 * A line requested before the switch to times that asks for AM and Night but
 * not PM: two separate periods, which cannot be booked as one. Decided on PR
 * #89's follow-ups: refuse, rather than book 07:00-24:00 and take PM as well.
 */
export function isNonAdjacentSlots(slots: readonly string[] | null): boolean {
  return slots !== null && slots.includes('am') && slots.includes('night') && !slots.includes('pm');
}

/** Each slot's times, as 20261008140500_time_model.sql filled them in. */
const LEGACY_SLOT_PERIODS: Readonly<Record<string, ClockRange>> = {
  am: { start: '07:00', end: '12:00' },
  pm: { start: '13:00', end: '18:00' },
  night: { start: '19:00', end: '24:00' },
};

/**
 * PR #100 review: a suggestion made before the switch to times, in slots, has
 * no period of its own when it is AM and Night without PM (the migration
 * leaves it in slots rather than offer 07:00-24:00). It is shown as each
 * slot's period, in day order, so PM is not offered.
 */
export function legacySuggestionPeriods(slots: readonly string[]): ClockRange[] {
  return Object.entries(LEGACY_SLOT_PERIODS)
    .filter(([slot]) => slots.includes(slot))
    .map(([, period]) => ({ ...period }));
}

/**
 * AC4: a line's conflicts, from what getVenueCommitments returned for its
 * period with the event's own holds already left out (SCRUM-227 AC5,
 * withoutOwnHolds). Each event is named from `events`, by id.
 */
export function approvalConflictsFor(
  line: { id: string; date: string; legacySlots: readonly string[] | null } & ClockRange,
  commitments: readonly VenueCommitment[],
  events: ReadonlyMap<string, EventName>,
): ApprovalConflict[] {
  if (isNonAdjacentSlots(line.legacySlots)) {
    return [{ lineId: line.id, date: line.date, start: line.start, end: line.end, kind: 'non_adjacent_slots' }];
  }
  return commitments
    .filter((c) => c.date === line.date && rangesOverlap(c, line))
    .map((c): ApprovalConflict => {
      const base = { lineId: line.id, date: c.date, start: c.start, end: c.end };
      const event = c.eventRequestId ? (events.get(c.eventRequestId) ?? null) : null;
      switch (c.kind) {
        case 'booking':
          return { ...base, kind: 'booked', event };
        case 'hold':
          return { ...base, kind: 'held', event, expiresAt: c.expiresAt ?? null };
        case 'unavailable':
          return { ...base, kind: 'unavailable', reason: c.reason ?? '' };
      }
    });
}

/**
 * AC4: "10:00–12:00 on 15 Nov 2026 is already booked for EVT-2026-0101 (Tech
 * Summit)." AC8 and SCRUM-155 AC5: "14:00–16:30 on 15 Nov 2026 is unavailable:
 * Aircon repair."
 */
export function describeApprovalConflict(conflict: ApprovalConflict): string {
  const when = `${formatClockRange(conflict)} on ${formatSingaporeDate(conflict.date)}`;
  switch (conflict.kind) {
    case 'booked':
      return `${when} is already booked${conflict.event ? ` for ${conflict.event.reference} (${conflict.event.name})` : ''}.`;
    case 'held':
      return `${when} is held${conflict.event ? ` for ${conflict.event.reference} (${conflict.event.name})` : ''}${
        conflict.expiresAt ? ` until ${formatExpiry(conflict.expiresAt)}` : ''
      }.`;
    case 'unavailable':
      return `${when} is unavailable${conflict.reason ? `: ${conflict.reason}` : ''}.`;
    case 'non_adjacent_slots':
      return `This line was requested as AM and Night on ${formatSingaporeDate(conflict.date)}, which are not next to each other, so it cannot be booked as one period. Reject it and ask the coordinator to request each period separately.`;
  }
}

/** AC4: what a competing request's coordinator is told. */
export function periodCommittedMessage(venueName: string, lines: readonly ({ date: string } & ClockRange)[]): string {
  return `Your booking request for ${venueName} was rejected for ${lines.map(describePeriod).join(', ')}: the period is now committed to another event.`;
}
