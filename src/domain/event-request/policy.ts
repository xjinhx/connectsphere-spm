import { eventRequestCoreSchema, type EventRequestDraft } from './schema';
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
 */
export function isProposedDateSubmittable(
  proposedDate: Date,
  today: ISODate = todayInSingapore(),
): boolean {
  return !isPastDate(toSingaporeISODate(proposedDate), today);
}

/**
 * SCRUM-76 AC3 — everything standing between a draft and submission.
 * Empty means it can be submitted.
 *
 * A draft is never put through this: saving is always allowed, which is what
 * lets an organiser keep a half-finished request with a date they still have
 * to fix.
 */
export function submissionProblems(
  draft: EventRequestDraft,
  today: ISODate = todayInSingapore(),
): string[] {
  const parsed = eventRequestCoreSchema.safeParse(draft);
  const problems = parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);

  // Checked outside the schema because "in the past" depends on today's date in
  // Singapore - that is a rule, not a shape.
  if (draft.proposedDate instanceof Date && !isProposedDateSubmittable(draft.proposedDate, today)) {
    problems.push(PAST_PROPOSED_DATE_MESSAGE);
  }

  return problems;
}

export function canSubmit(
  draft: EventRequestDraft,
  today: ISODate = todayInSingapore(),
): boolean {
  return submissionProblems(draft, today).length === 0;
}