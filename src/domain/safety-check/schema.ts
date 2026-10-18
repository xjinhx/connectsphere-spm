import { z } from 'zod';
import { EventRequestStatusEnum } from '@/domain/event-request/schema';

/**
 * Operational safety check (SCRUM-234 Run the Operational Safety Check): data
 * shapes shared by the API routes and the UI.
 *
 * The Safety Officer checks a Confirmed event before it moves into
 * Preparation, and approves it, requests changes or rejects it. Each decision
 * is kept, with who made it and when.
 *
 * Single-field rules live here; who may do what, and when, is policy.ts.
 */

export const SAFETY_CHECK_DECISIONS = ['approved', 'changes_requested', 'rejected'] as const;
export const SafetyCheckDecisionSchema = z.enum(SAFETY_CHECK_DECISIONS);
export type SafetyCheckDecision = z.infer<typeof SafetyCheckDecisionSchema>;

/** One spelling everywhere: the list, the check page and the coordinator's event page. */
export const SAFETY_CHECK_DECISION_LABELS: Record<SafetyCheckDecision, string> = {
  approved: 'Approved',
  changes_requested: 'Changes requested',
  rejected: 'Rejected',
};

/** 1000 characters, as the other free-text notes (the column check is the backstop). */
export const SAFETY_NOTE_MAX_LENGTH = 1000;
/** AC4: "when I save with a reason", for a rejection and a request for changes alike. */
export const REASON_REQUIRED_MESSAGE = 'Enter the reason for your decision.';
const NOTE_TOO_LONG_MESSAGE = `Must be ${SAFETY_NOTE_MAX_LENGTH} characters or fewer.`;

/**
 * AC3: "Given I approve the event, when I save" - no reason.
 * AC4: "Given I reject the safety arrangement or request changes, when I save
 * with a reason" - both need one (Change Log CL-27 merged the two criteria).
 *
 * The reason is trimmed; one that is empty or only spaces is refused
 * (TC-234-12), with the field named. An approval keeps no reason, so any sent
 * with one is dropped rather than refused. Stored in the `note` column.
 */
export const RecordSafetyCheckInputSchema = z
  .object({
    decision: SafetyCheckDecisionSchema,
    note: z
      .string({ invalid_type_error: 'The note must be text.' })
      .max(SAFETY_NOTE_MAX_LENGTH, NOTE_TOO_LONG_MESSAGE)
      .optional()
      .nullable(),
  })
  .transform((input, ctx) => {
    if (input.decision === 'approved') return { decision: input.decision, note: null };
    const note = input.note?.trim() ?? '';
    if (note === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: REASON_REQUIRED_MESSAGE,
      });
      return z.NEVER;
    }
    return { decision: input.decision, note };
  });
export type RecordSafetyCheckInput = z.infer<typeof RecordSafetyCheckInputSchema>;

/** One recorded decision: what, the reason, who and when (AC3, AC4). */
export const SafetyCheckRecordSchema = z.object({
  id: z.string().uuid(),
  decision: SafetyCheckDecisionSchema,
  note: z.string().nullable(),
  decidedBy: z.string().uuid(),
  decidedByName: z.string(),
  decidedAt: z.string(),
});
export type SafetyCheckRecord = z.infer<typeof SafetyCheckRecordSchema>;

/** AC1: one Confirmed event on the Safety Officer's list. */
export const SafetyCheckQueueItemSchema = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  name: z.string(),
  clientOrganisation: z.string().nullable(),
  proposedDate: z.string().nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  expectedAttendance: z.number().int().nullable(),
  /** The venues of its confirmed bookings, each named once. */
  venues: z.array(z.string()),
});
export type SafetyCheckQueueItem = z.infer<typeof SafetyCheckQueueItemSchema>;

/** A requirement and whether it is the event's own (SCRUM-230: "shown as the event's"). */
const InUseSchema = z.object({ description: z.string(), fromEvent: z.boolean() });

/**
 * AC2: one venue the event is booked at, with its capacity for the requested
 * layout, and the attendance and accessibility needs that booking goes by. Bookings made from
 * the same request share these, so they are one entry with each date and time.
 */
export const SafetyCheckVenueSchema = z.object({
  venueId: z.string().uuid(),
  venueName: z.string(),
  maxCapacity: z.number().int(),
  /** The layout in use, "Not specified" when neither the request nor the event names one. */
  layout: InUseSchema,
  /** The venue's capacity in that layout, or null when it has no figure for it (or no layout is set). */
  layoutCapacity: z.number().int().nullable(),
  expectedAttendance: InUseSchema,
  accessibility: InUseSchema,
  bookings: z.array(z.object({ date: z.string(), startTime: z.string(), endTime: z.string() })),
});
export type SafetyCheckVenue = z.infer<typeof SafetyCheckVenueSchema>;

/** AC2: everything the Safety Officer decides from, plus the event's earlier checks. */
export const SafetyCheckViewSchema = z.object({
  eventRequestId: z.string().uuid(),
  reference: z.string(),
  name: z.string(),
  status: EventRequestStatusEnum,
  clientOrganisation: z.string().nullable(),
  proposedDate: z.string().nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  expectedAttendance: z.string(),
  roomLayout: z.string(),
  accessibility: z.string(),
  venues: z.array(SafetyCheckVenueSchema),
  equipment: z.array(z.object({ name: z.string(), quantity: z.number().int() })),
  technicalRequirements: z.string().nullable(),
  /** AC3: a decision can be recorded now - the event is Confirmed. */
  awaitingCheck: z.boolean(),
  checks: z.array(SafetyCheckRecordSchema),
});
export type SafetyCheckView = z.infer<typeof SafetyCheckViewSchema>;

/** What recording a decision returns: the decision and the event's new status. */
export const RecordSafetyCheckOutcomeSchema = z.object({
  check: SafetyCheckRecordSchema,
  status: EventRequestStatusEnum,
});
export type RecordSafetyCheckOutcome = z.infer<typeof RecordSafetyCheckOutcomeSchema>;
