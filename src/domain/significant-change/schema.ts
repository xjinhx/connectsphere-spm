import { z } from 'zod';
import {
  ACCESSIBILITY_NOTES_MAX_LENGTH,
  eventRequestCoreSchema,
  optionalFromBlank,
  timeRangeIssues,
} from '@/domain/event-request/schema';
import { isISODate, isPastDate } from '@/domain/shared/dates';
import { EndTimeSchema, StartTimeSchema, type ClockTime } from '@/domain/shared/times';
import { RoomLayoutSchema, type RoomLayout } from '@/domain/venues/schema';

/**
 * SCRUM-111 — Flag affected arrangements and mark them for review after a
 * significant change (absorbs SCRUM-112).
 *
 * A significant change is one to the event's date, times, expected attendance
 * or venue requirements (AC5). The requirements the coordinator can change
 * here are the room layout and the accessibility answer with its notes; the
 * accessibility features chosen from the list stay as the organiser left them
 * (and go with a "no", the same rule as SCRUM-79's normaliseAccessibility).
 */

/** What a significant change can touch, as stored on the event. Null is "not provided". */
export interface ScheduleValues {
  /** YYYY-MM-DD. */
  proposedDate: string | null;
  /** HH:MM, Singapore clock time. */
  startTime: ClockTime | null;
  endTime: ClockTime | null;
  expectedAttendance: number | null;
  roomLayout: RoomLayout | null;
  accessibilityRequired: boolean | null;
  accessibilityNotes: string | null;
}

export type SignificantChangeKind = 'date' | 'times' | 'attendance' | 'requirements';

export const PAST_DATE_MESSAGE = 'The date has already passed. Choose today or a later date.';

/**
 * The coordinator's change. Date, times and attendance are required: an event
 * that has arrangements always has them. `acknowledged` is AC1/AC2's explicit
 * acknowledgement; false (or missing) when the coordinator has not ticked it.
 *
 * AC4: the only date rule is that it is not in the past. There is no cut-off,
 * so a Confirmed event starting tomorrow can still change.
 */
export const EventScheduleInputSchema = z
  .object({
    proposedDate: z
      .string({ required_error: 'Date is required' })
      .refine(isISODate, 'Enter the date as a calendar date.'),
    startTime: z.string({ required_error: 'Start time is required' }).pipe(StartTimeSchema),
    endTime: z.string({ required_error: 'End time is required' }).pipe(EndTimeSchema),
    expectedAttendance: eventRequestCoreSchema.shape.expectedAttendance,
    roomLayout: optionalFromBlank(RoomLayoutSchema),
    accessibilityRequired: optionalFromBlank(z.boolean()),
    accessibilityNotes: optionalFromBlank(
      z
        .string()
        .max(
          ACCESSIBILITY_NOTES_MAX_LENGTH,
          `Accessibility notes must be ${ACCESSIBILITY_NOTES_MAX_LENGTH} characters or fewer.`,
        ),
    ),
    acknowledged: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (isISODate(value.proposedDate) && isPastDate(value.proposedDate)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['proposedDate'], message: PAST_DATE_MESSAGE });
    }
    for (const issue of timeRangeIssues(value.startTime, value.endTime)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.field], message: issue.message });
    }
  });

export type EventScheduleInput = z.infer<typeof EventScheduleInputSchema>;

export const ArrangementKindSchema = z.enum(['venue_booking', 'equipment_reservation']);
export type ArrangementKind = z.infer<typeof ArrangementKindSchema>;

/** AC9: the arrangement the coordinator re-confirms. */
export const ReconfirmArrangementInputSchema = z.object({
  kind: ArrangementKindSchema,
  id: z.string().uuid('Choose an arrangement of this event.'),
});
export type ReconfirmArrangementInput = z.infer<typeof ReconfirmArrangementInputSchema>;

/** AC5-AC7, AC9: an arrangement's review state, as every view returns it. */
export interface ReviewState {
  reviewRequired: boolean;
  /** ISO timestamp the flag was last set; kept after a re-confirmation. */
  reviewRequiredAt: string | null;
  /** The change that last set it, e.g. "Date changed from 20/11/2026 to 27/11/2026". */
  reviewRequiredCause: string | null;
  /** ISO timestamp of the latest re-confirmation (AC9). */
  reconfirmedAt: string | null;
  reconfirmedByName: string | null;
}

/** One active arrangement of the event: a confirmed venue booking or a reserved equipment reservation. */
export interface ArrangementSummary extends ReviewState {
  kind: ArrangementKind;
  id: string;
  /** e.g. "Marina Bay Ballroom, 20/11/2026, 10:00–12:00" or "Projector P-100 × 2, 19/11/2026 to 20/11/2026". */
  label: string;
}

/** The coordinator's page: the values, the arrangements they would affect, and what may be done. */
export interface EventScheduleView {
  values: ScheduleValues;
  canEdit: boolean;
  readOnlyReason: string | null;
  bookings: ArrangementSummary[];
  reservations: ArrangementSummary[];
}

/** What a saved change flagged (AC5). */
export interface ScheduleChangeResult {
  values: ScheduleValues;
  flaggedBookings: number;
  flaggedReservations: number;
}
