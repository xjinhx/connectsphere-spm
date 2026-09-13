import {
  eventRequestCoreSchema,
  MANDATORY_FIELD_LABELS,
  normaliseTimeSlots,
  TIME_SLOT_LABELS,
  TIME_SLOT_ORDER,
  type EventRequestStatus,
  type MandatoryField,
  type TimeSlot,
} from './schema';
import {
  formatSingaporeDateTime,
  isPastDate,
  todayInSingapore,
  toSingaporeISODate,
  type ISODate,
} from '@/domain/shared/dates';
import { ROOM_LAYOUT_LABELS, type RoomLayout } from '@/domain/venues/schema';

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
 * This is the rule only. It is applied at submission by incompleteFields()
 * below (SCRUM-82).
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

// ---------------------------------------------------------------------------
// SCRUM-79 — State venue and accessibility requirements
// ---------------------------------------------------------------------------

/** AC1 — what the request shows for its layout, in the catalogue's own words. */
export function describeRoomLayout(layout: RoomLayout | null): string {
  return layout ? ROOM_LAYOUT_LABELS[layout] : 'Not yet provided';
}

/** The accessibility answer as it is stored: the answer, then what it needs. */
export interface AccessibilityRequirement {
  /** Null is "not yet answered"; false is "none" (AC3); true is "yes" (AC2). */
  required: boolean | null;
  featureIds: string[];
  notes: string | null;
}

/**
 * AC2 and AC3 — only a "yes" carries features and notes. When the answer is
 * "none" or not yet given, anything left over in those inputs (say, notes
 * typed before the organiser changed their mind) is dropped rather than saved
 * against an answer that contradicts it. The database enforces the notes half
 * of this; the features half lives in a link table, so it is enforced here.
 */
export function normaliseAccessibility(input: {
  accessibilityRequired?: boolean;
  accessibilityFeatureIds: string[];
  accessibilityNotes?: string;
}): AccessibilityRequirement {
  const required = input.accessibilityRequired ?? null;
  if (required !== true) return { required, featureIds: [], notes: null };

  const notes = input.accessibilityNotes?.trim() ?? '';
  return {
    required: true,
    // A selection is a set: the same feature ticked twice is one feature.
    featureIds: [...new Set(input.accessibilityFeatureIds)],
    notes: notes === '' ? null : notes,
  };
}

/** AC2/AC3 — what the request shows for accessibility: an answer, never a blank. */
export function describeAccessibility(request: {
  accessibilityRequired: boolean | null;
  accessibilityFeatures: readonly { name: string }[];
  accessibilityNotes: string | null;
}): string {
  if (request.accessibilityRequired === null) return 'Not yet answered';
  if (request.accessibilityRequired === false) return 'None required';

  const lines: string[] = [];
  if (request.accessibilityFeatures.length > 0) {
    lines.push(request.accessibilityFeatures.map((feature) => feature.name).join(', '));
  }
  if (request.accessibilityNotes) lines.push(request.accessibilityNotes);
  return lines.length > 0 ? lines.join('\n') : 'Required - details not yet given';
}

/** AC4 — a blank location is recorded, and shown, as no preference. */
export function describePreferredLocation(location: { name: string } | null): string {
  return location ? location.name : 'No preference';
}

// ---------------------------------------------------------------------------
// SCRUM-82 — Submit a completed event request
// ---------------------------------------------------------------------------

/** One field standing between a request and submission, named for the organiser. */
export interface IncompleteField {
  field: MandatoryField;
  label: string;
  reason: string;
}

/**
 * The stored request as the completeness check sees it: every mandatory field
 * possibly still empty. Nulls are what the database hands back for a column
 * that was never filled in.
 */
export interface StoredEventRequestFields {
  name: string | null;
  purpose: string | null;
  description: string | null;
  proposedDate: string | null;
  timeSlots: string[] | null;
  expectedAttendance: number | null;
}

/**
 * AC2 — everything incomplete in the mandatory set, each listed once by name.
 * Empty means the request may be submitted (AC1).
 *
 * The mandatory set is eventRequestCoreSchema. A field is "incomplete" if the
 * schema refuses it, or - for the proposed date only - if it has already
 * passed (SCRUM-76 AC3: savable, but not submittable).
 */
export function incompleteFields(
  request: StoredEventRequestFields,
  today: ISODate = todayInSingapore(),
): IncompleteField[] {
  const parsed = eventRequestCoreSchema.safeParse({
    name: request.name ?? undefined,
    purpose: request.purpose ?? undefined,
    description: request.description ?? undefined,
    proposedDate: request.proposedDate ?? undefined,
    timeSlots: request.timeSlots ?? undefined,
    expectedAttendance: request.expectedAttendance ?? undefined,
  });

  const problems = new Map<MandatoryField, string>();

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (isMandatoryField(field) && !problems.has(field)) {
        problems.set(field, issue.message);
      }
    }
  }

  if (
    !problems.has('proposedDate') &&
    request.proposedDate !== null &&
    !isProposedDateSubmittable(new Date(request.proposedDate), today)
  ) {
    problems.set('proposedDate', PAST_PROPOSED_DATE_MESSAGE);
  }

  // Listed in the order the form shows them, not the order the issues arrived.
  return (Object.keys(MANDATORY_FIELD_LABELS) as MandatoryField[])
    .filter((field) => problems.has(field))
    .map((field) => ({
      field,
      label: MANDATORY_FIELD_LABELS[field],
      reason: problems.get(field) ?? '',
    }));
}

function isMandatoryField(value: unknown): value is MandatoryField {
  return typeof value === 'string' && value in MANDATORY_FIELD_LABELS;
}

/** AC1 — a request can be submitted only when nothing is incomplete. */
export function canSubmit(
  request: StoredEventRequestFields,
  today: ISODate = todayInSingapore(),
): boolean {
  return incompleteFields(request, today).length === 0;
}

/**
 * AC2 and AC4 — a draft stays editable; a submitted request is read-only, and
 * no edit, save or delete is offered. "Until a coordinator returns it with a
 * clarification request" is a later story, which will add a status here.
 */
export function isEditable(status: EventRequestStatus): boolean {
  return status === 'draft';
}

/** AC1 — the only transition this story knows: a draft becomes submitted. */
export function canBeSubmitted(status: EventRequestStatus): boolean {
  return status === 'draft';
}

// ---------------------------------------------------------------------------
// SCRUM-83 / SCRUM-85 — Save an incomplete request as a draft, and resume it
// ---------------------------------------------------------------------------

/**
 * SCRUM-85 AC3 — a saved draft can be reopened and editing continues; a
 * submitted request cannot (SCRUM-82 AC4 already made it read-only).
 *
 * Deliberately the same rule as isEditable(), not a second opinion about it:
 * "can I resume this draft" and "is this request still editable" are one
 * question asked by two stories. Named separately so each story's tests point
 * at their own rule, and so a future status (e.g. Clarification Requested)
 * that changes one but not the other has an obvious place to diverge.
 */
export function isResumable(status: EventRequestStatus): boolean {
  return isEditable(status);
}

/**
 * SCRUM-83 AC3 (Jira) — a draft belongs to the organiser who saved it. A
 * colleague in the same client organisation may not open it, and it is not
 * listed for them: sharing is by organisation for *submitted* work, never for
 * someone else's unfinished draft.
 *
 * The "not listed" half is the query itself (listEventRequestsForOrganiser
 * filters on organiser_id); this is the "access is denied" half, applied by
 * requireOwnRequest() in service.ts before any draft is handed back.
 */
export function isOwnRequest(
  request: { organiserId: string },
  actorUserId: string,
): boolean {
  return request.organiserId === actorUserId;
}

/**
 * AC3 (US-5.3-TC05) — what the event list says about a request's submission.
 * The instant is rendered in Singapore time, like every other date in the app.
 */
export function submissionSummary(submittedAt: string | null): string {
  return submittedAt ? `Submitted ${formatSingaporeDateTime(submittedAt)}` : 'Not yet submitted';
}