import { isCurrentCoordinator } from '@/domain/assignment/policy';
import {
  NOT_ASSIGNED_MESSAGE,
  canEditEventInformation,
  finishedEventNotice,
  isFinishedEvent,
} from '@/domain/event-information/policy';
import { EventRequestIdSchema } from '@/domain/event-status/schema';
import { hasRole } from '@/domain/identity/policy';
import type { Role } from '@/domain/identity/roles';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/domain/shared/errors';
import { formatClockRange } from '@/domain/shared/times';
import type { RoomLayout } from '@/domain/venues/schema';
import {
  changeEventScheduleRow,
  fetchArrangementForReconfirm,
  fetchConfirmedBookingArrangements,
  fetchEventScheduleRow,
  fetchProfileNames,
  fetchReservedEquipmentArrangements,
  reconfirmArrangementRow,
  type BookingArrangementRow,
  type EventScheduleRow,
  type ReservationArrangementRow,
  type ReviewColumns,
} from '@/lib/supabase/eventSchedule';
import { changeCauses, formatDayMonthYear } from './policy';
import {
  EventScheduleInputSchema,
  ReconfirmArrangementInputSchema,
  type ArrangementSummary,
  type EventScheduleView,
  type ReviewState,
  type ScheduleChangeResult,
  type ScheduleValues,
} from './schema';

/**
 * SCRUM-111 — Flag affected arrangements and mark them for review after a
 * significant change (absorbs SCRUM-112).
 *
 * AC1, AC2 a change that affects an arrangement needs the coordinator's
 *          acknowledgement; without it nothing is saved.
 * AC3      a descriptive change (SCRUM-110's fields) never comes here, and a
 *          save that changes no significant field affects nothing.
 * AC4      no cut-off: a Confirmed event starting tomorrow can still change.
 * AC5      on save, every affected arrangement is flagged with the time and
 *          the cause, in the same transaction (change_event_schedule).
 * AC6, AC7 the flag, its time and cause come back with each arrangement.
 * AC8      re-confirming every flagged arrangement leaves none flagged.
 * AC9      the assigned coordinator re-confirms one; who and when are saved.
 *
 * Who may change it is SCRUM-110's rule: the event's assigned coordinator,
 * while it is not Completed or Cancelled.
 */

export const ACKNOWLEDGEMENT_REQUIRED_MESSAGE =
  'This change affects arrangements already agreed. Confirm that they will be marked for review, then save again.';
export const CHANGED_SINCE_READ_MESSAGE =
  'This event was changed by someone else while you were editing it. Reload the page and make your change again.';
export const NOT_FLAGGED_MESSAGE = 'This arrangement is not marked for review.';

/** AC1, AC2: refused because an affected arrangement was not acknowledged. Nothing was saved. */
export class AcknowledgementRequiredError extends ConflictError {
  constructor(affected: { bookings: string[]; reservations: string[] }) {
    super(ACKNOWLEDGEMENT_REQUIRED_MESSAGE, { acknowledgementRequired: true, ...affected });
    this.name = 'AcknowledgementRequiredError';
  }
}

type Actor = { userId: string; roles: readonly Role[] };

async function readEvent(eventRequestId: string): Promise<EventScheduleRow> {
  if (!EventRequestIdSchema.safeParse(eventRequestId).success) throw new NotFoundError('Event request');
  const { data, error } = await fetchEventScheduleRow(eventRequestId);
  if (error) throw new ValidationError('The event could not be read.', error.message);
  if (!data) throw new NotFoundError('Event request');
  return data as unknown as EventScheduleRow;
}

/** Postgres `time` (10:00:00) as a clock time (10:00); 24:00:00 stays 24:00. */
function clock(value: string | null): string | null {
  return value === null ? null : value.slice(0, 5);
}

function toValues(row: EventScheduleRow): ScheduleValues {
  return {
    proposedDate: row.proposed_date,
    startTime: clock(row.start_time),
    endTime: clock(row.end_time),
    expectedAttendance: row.expected_attendance,
    roomLayout: row.room_layout as RoomLayout | null,
    accessibilityRequired: row.accessibility_required,
    accessibilityNotes: row.accessibility_notes,
  };
}

function toReviewState(row: ReviewColumns, names: ReadonlyMap<string, string>): ReviewState {
  return {
    reviewRequired: row.review_required,
    reviewRequiredAt: row.review_required_at,
    reviewRequiredCause: row.review_required_cause,
    reconfirmedAt: row.reconfirmed_at,
    reconfirmedByName: row.reconfirmed_by ? (names.get(row.reconfirmed_by) ?? 'Unknown account') : null,
  };
}

/** e.g. "Marina Bay Ballroom, 20/11/2026, 10:00–12:00". */
function bookingLabel(row: BookingArrangementRow): string {
  const times = formatClockRange({ start: row.start_time.slice(0, 5), end: row.end_time.slice(0, 5) });
  return `${row.venue?.name ?? 'Unknown venue'}, ${formatDayMonthYear(row.date)}, ${times}`;
}

/** e.g. "Projector P-100 × 2, 19/11/2026 to 20/11/2026". */
function reservationLabel(row: ReservationArrangementRow): string {
  return `${row.equipment?.name ?? 'Unknown item'} × ${row.quantity}, ${formatDayMonthYear(row.window_start)} to ${formatDayMonthYear(row.window_end)}`;
}

/** AC6, AC7: the event's active arrangements, each with its review state. */
export async function listEventArrangements(
  eventRequestId: string,
): Promise<{ bookings: ArrangementSummary[]; reservations: ArrangementSummary[] }> {
  const [bookingResult, reservationResult] = await Promise.all([
    fetchConfirmedBookingArrangements(eventRequestId),
    fetchReservedEquipmentArrangements(eventRequestId),
  ]);
  if (bookingResult.error || !bookingResult.data) {
    throw new ValidationError("The event's venue bookings could not be read.", bookingResult.error?.message);
  }
  if (reservationResult.error || !reservationResult.data) {
    throw new ValidationError("The event's equipment reservations could not be read.", reservationResult.error?.message);
  }
  const bookings = bookingResult.data as unknown as BookingArrangementRow[];
  const reservations = reservationResult.data as unknown as ReservationArrangementRow[];

  const reconfirmers = [...bookings, ...reservations].flatMap((row) => (row.reconfirmed_by ? [row.reconfirmed_by] : []));
  const names = new Map<string, string>();
  if (reconfirmers.length > 0) {
    const { data } = await fetchProfileNames([...new Set(reconfirmers)]);
    for (const profile of data ?? []) names.set(profile.id, profile.full_name ?? 'Unknown account');
  }

  return {
    bookings: bookings.map((row) => ({
      kind: 'venue_booking' as const,
      id: row.id,
      label: bookingLabel(row),
      ...toReviewState(row, names),
    })),
    reservations: reservations.map((row) => ({
      kind: 'equipment_reservation' as const,
      id: row.id,
      label: reservationLabel(row),
      ...toReviewState(row, names),
    })),
  };
}

/**
 * For the coordinator's event page: the values a significant change touches,
 * the arrangements it could affect, and whether this viewer may change them.
 * The Event Coordinator Lead sees it read-only (SCRUM-232 AC5), the same
 * people as SCRUM-110's getEventInformation.
 */
export async function getEventSchedule(eventRequestId: string, actor: Actor): Promise<EventScheduleView> {
  const event = await readEvent(eventRequestId);
  const assigned = isCurrentCoordinator(event.coordinator_id, actor.userId);
  if (!assigned && !hasRole([...actor.roles], 'operations_manager')) {
    throw new ForbiddenError(NOT_ASSIGNED_MESSAGE);
  }
  const arrangements = await listEventArrangements(event.id);
  return {
    values: toValues(event),
    canEdit: canEditEventInformation({ status: event.status, coordinatorId: event.coordinator_id }, actor.userId),
    readOnlyReason: isFinishedEvent(event.status) ? finishedEventNotice(event.status) : null,
    ...arrangements,
  };
}

/**
 * AC1, AC2, AC4, AC5: the assigned coordinator changes the date, times,
 * expected attendance or venue requirements.
 *
 * Checked in SCRUM-110's order: the coordinator first, then the input, then
 * the status. Which arrangements are affected, and the cause recorded on
 * each, are worked out here from what is stored (policy.ts); the database
 * function then saves and flags in one transaction, refusing without the
 * acknowledgement when anything is affected, and refusing outright if the
 * event was saved by someone else after this read (so the causes stay true).
 *
 * `actorId` is whoever is signed in, from the route, never from the body.
 */
export async function changeEventSchedule(
  eventRequestId: string,
  actorId: string,
  input: unknown,
): Promise<ScheduleChangeResult> {
  const event = await readEvent(eventRequestId);
  if (!isCurrentCoordinator(event.coordinator_id, actorId)) throw new ForbiddenError(NOT_ASSIGNED_MESSAGE);

  const parsed = EventScheduleInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'The change is not valid.', parsed.error.flatten());
  }
  if (isFinishedEvent(event.status)) throw new ConflictError(finishedEventNotice(event.status));

  const values = parsed.data;
  const accessibilityRequired = values.accessibilityRequired ?? null;
  const after: ScheduleValues = {
    proposedDate: values.proposedDate,
    startTime: values.startTime,
    endTime: values.endTime,
    expectedAttendance: values.expectedAttendance,
    roomLayout: values.roomLayout ?? null,
    accessibilityRequired,
    // SCRUM-79: notes only go with a "yes".
    accessibilityNotes: accessibilityRequired === true ? values.accessibilityNotes?.trim() || null : null,
  };
  const causes = changeCauses(toValues(event), after);

  const { data, error } = await changeEventScheduleRow({
    eventRequestId: event.id,
    coordinatorId: actorId,
    expectedUpdatedAt: event.updated_at,
    proposedDate: values.proposedDate,
    startTime: values.startTime,
    endTime: values.endTime,
    expectedAttendance: values.expectedAttendance,
    roomLayout: after.roomLayout,
    accessibilityRequired: after.accessibilityRequired,
    accessibilityNotes: after.accessibilityNotes,
    bookingCause: causes.booking,
    reservationCause: causes.reservation,
    acknowledged: values.acknowledged,
  });
  if (error || !data) throw new ValidationError('The change could not be saved.', error?.message);

  const result = data as { outcome: string; status?: string; bookings?: string[]; reservations?: string[] };
  switch (result.outcome) {
    case 'not_found':
      throw new NotFoundError('Event request');
    case 'not_assigned':
      throw new ForbiddenError(NOT_ASSIGNED_MESSAGE);
    case 'finished':
      throw new ConflictError(finishedEventNotice(result.status as 'completed' | 'cancelled'));
    case 'changed':
      throw new ConflictError(CHANGED_SINCE_READ_MESSAGE);
    case 'acknowledgement_required': {
      // Named the way the page names them, so the refusal says what is affected.
      const arrangements = await listEventArrangements(event.id);
      const label = (list: ArrangementSummary[], ids: string[] = []) =>
        list.filter((item) => ids.includes(item.id)).map((item) => item.label);
      throw new AcknowledgementRequiredError({
        bookings: label(arrangements.bookings, result.bookings),
        reservations: label(arrangements.reservations, result.reservations),
      });
    }
    case 'saved':
      return {
        values: after,
        flaggedBookings: result.bookings?.length ?? 0,
        flaggedReservations: result.reservations?.length ?? 0,
      };
    default:
      throw new ValidationError('The change could not be saved.', result);
  }
}

/**
 * AC9: the event's assigned coordinator marks one flagged booking or
 * reservation re-confirmed. The flag is cleared, and who and when are saved.
 * AC8 follows: once every flagged one is re-confirmed, none remains.
 *
 * Refused for anyone but the assigned coordinator (the Lead included), for an
 * arrangement of another event (not found, so nothing about it is told), for
 * one that is not flagged, and on a Completed or Cancelled event, whose record
 * is history (SCRUM-110 AC5).
 */
export async function reconfirmArrangement(
  eventRequestId: string,
  actorId: string,
  input: unknown,
): Promise<ArrangementSummary> {
  const event = await readEvent(eventRequestId);
  if (!isCurrentCoordinator(event.coordinator_id, actorId)) throw new ForbiddenError(NOT_ASSIGNED_MESSAGE);

  const parsed = ReconfirmArrangementInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Choose an arrangement to re-confirm.', parsed.error.flatten());
  }
  if (isFinishedEvent(event.status)) throw new ConflictError(finishedEventNotice(event.status));

  const { kind, id } = parsed.data;
  const notFound = kind === 'venue_booking' ? 'Venue booking' : 'Equipment reservation';
  const { data, error } = await fetchArrangementForReconfirm(kind, id);
  if (error) throw new ValidationError('The arrangement could not be read.', error.message);
  const row = data as { event_request_id: string; status: string; review_required: boolean } | null;
  if (!row || row.event_request_id !== event.id) throw new NotFoundError(notFound);
  if (!row.review_required) throw new ConflictError(NOT_FLAGGED_MESSAGE);

  const { data: updated, error: updateError } = await reconfirmArrangementRow(kind, id, actorId);
  if (updateError) throw new ValidationError('The arrangement could not be re-confirmed.', updateError.message);
  if (!updated) throw new ConflictError(NOT_FLAGGED_MESSAGE);

  const arrangements = await listEventArrangements(event.id);
  const summary = [...arrangements.bookings, ...arrangements.reservations].find((item) => item.id === id);
  if (!summary) throw new NotFoundError(notFound);
  return summary;
}
