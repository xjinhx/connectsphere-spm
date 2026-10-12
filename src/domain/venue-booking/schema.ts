import { z } from 'zod';
import { isISODate } from '@/domain/shared/dates';
import { EndTimeSchema, StartTimeSchema, isQuarterHourEnd, isQuarterHourStart, toMinutes } from '@/domain/shared/times';

// ---------------------------------------------------------------------------
// SCRUM-142 — Submit a venue booking request for an event
// ---------------------------------------------------------------------------
// AC1: one venue, a date, and the period needed. AC3: several dates for the
// same venue are lines on the SAME request, not separate requests, each with
// its own independent decision status.
//
// SCRUM-239 AC3 (customer change Week 7 #1): a line is a date and a start and
// end time on the 15-minute unit, replacing SCRUM-142's AM / PM / Night slots.
// SCRUM-142 stays Done on slots (Week 7 guide, scenario 2); its rules carry
// over in time ranges.

// Same convention as review/schema.ts's own EventRequestIdSchema: each
// domain validates the id shape locally rather than importing another
// domain's copy of the same one-liner.
export const EventRequestIdSchema = z.string().uuid();

export const END_NOT_AFTER_START = 'The end time must be after the start time.';

/**
 * A required clock time with its own "choose one" message (SCRUM-142 AC5: the
 * missing field is named), then the shared 15-minute rule (SCRUM-238 AC4).
 */
function requiredTime(missing: string, onUnit: typeof StartTimeSchema) {
  return z
    .string({ required_error: missing, invalid_type_error: missing })
    .trim()
    .min(1, missing)
    .pipe(onUnit);
}

/**
 * When both times are on the unit but the end is not after the start, both
 * fields are flagged (as SCRUM-238 AC2: "both time fields are identified").
 * Zod still runs this when a field has already failed, so it only compares
 * valid times.
 */
function endAfterStart(range: { start?: unknown; end?: unknown }, ctx: z.RefinementCtx, fields: [string, string]) {
  const { start, end } = range;
  if (typeof start !== 'string' || typeof end !== 'string') return;
  if (!isQuarterHourStart(start) || !isQuarterHourEnd(end)) return;
  if (toMinutes(end) <= toMinutes(start)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [fields[0]], message: END_NOT_AFTER_START });
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [fields[1]], message: END_NOT_AFTER_START });
  }
}

export const VenueBookingRequestLineInputSchema = z
  .object({
    // AC5: an empty, blank or missing date coerces to an Invalid Date, which
    // would otherwise read "Invalid date" rather than say what to do.
    date: z.coerce.date({ errorMap: () => ({ message: 'Choose a date.' }) }),
    start: requiredTime('Choose a start time.', StartTimeSchema),
    end: requiredTime('Choose an end time.', EndTimeSchema),
  })
  .superRefine((line, ctx) => endAfterStart(line, ctx, ['start', 'end']));
export type VenueBookingRequestLineInput = z.infer<typeof VenueBookingRequestLineInputSchema>;

export const CreateVenueBookingRequestInputSchema = z.object({
  venueId: z.string().uuid('Venue must be chosen from the list.'),
  lines: z.array(VenueBookingRequestLineInputSchema).min(1, 'At least one date is required.'),
});
export type CreateVenueBookingRequestInput = z.infer<typeof CreateVenueBookingRequestInputSchema>;

const LINE_FIELDS = ['date', 'start', 'end'] as const;
type LineField = (typeof LINE_FIELDS)[number];

/** One line's missing or invalid fields, as the form shows them beside that line. */
export type VenueBookingLineErrors = Partial<Record<LineField, string[]>>;

/**
 * AC5: what a refused request sends back, so the form can name each missing
 * field. Zod's flatten() files every line's errors under one `lines` key with
 * no index, so a missing date on the second line could not be told from one on
 * the first. Here each line's errors stay with that line (`lineErrors`, by
 * position), and `fieldErrors`/`formErrors` keep the usual flatten() shape for
 * everything else (the venue, or a request with no lines at all).
 */
export interface VenueBookingRequestErrorDetails {
  formErrors: string[];
  fieldErrors: { venueId?: string[]; lines?: string[] };
  lineErrors: VenueBookingLineErrors[];
}

function isLineField(value: unknown): value is LineField {
  return (LINE_FIELDS as readonly unknown[]).includes(value);
}

/** Each line's errors, by position. Lines with nothing wrong are empty objects, never holes. */
export function lineErrorsFrom(issues: readonly { path: (string | number)[]; message: string }[]): VenueBookingLineErrors[] {
  const lineErrors: VenueBookingLineErrors[] = [];
  for (const issue of issues) {
    const [index, lineField] = issue.path;
    if (typeof index !== 'number' || !isLineField(lineField)) continue;
    const line = (lineErrors[index] ??= {});
    const messages = (line[lineField] ??= []);
    if (!messages.includes(issue.message)) messages.push(issue.message);
  }
  // Holes would go out as null in JSON; fill them with an empty object instead.
  return Array.from(lineErrors, (line) => line ?? {});
}

export function venueBookingRequestErrorDetails(
  error: z.ZodError<CreateVenueBookingRequestInput>,
): VenueBookingRequestErrorDetails {
  const lineIssues: { path: (string | number)[]; message: string }[] = [];
  const otherIssues: z.ZodIssue[] = [];

  for (const issue of error.issues) {
    const [field, index, lineField] = issue.path;
    if (field === 'lines' && typeof index === 'number' && isLineField(lineField)) {
      lineIssues.push({ path: [index, lineField], message: issue.message });
    } else {
      otherIssues.push(issue);
    }
  }

  const { formErrors, fieldErrors } = new z.ZodError<CreateVenueBookingRequestInput>(otherIssues).flatten();
  return {
    formErrors,
    fieldErrors: { venueId: fieldErrors.venueId, lines: fieldErrors.lines },
    lineErrors: lineErrorsFrom(lineIssues),
  };
}

// SCRUM-142 only ever creates pending lines. SCRUM-148 adds deciding one:
// approved or rejected (20261007090000_venue_booking_decision.sql).
export const VenueBookingRequestLineStatusEnum = z.enum(['pending', 'approved', 'rejected']);
export type VenueBookingRequestLineStatus = z.infer<typeof VenueBookingRequestLineStatusEnum>;

export interface VenueBookingRequestLine {
  id: string;
  date: string;
  /** SCRUM-239 AC3: the requested period, `HH:MM` Singapore time. */
  start: string;
  end: string;
  status: VenueBookingRequestLineStatus;
}

/** AC1/AC3 — what the coordinator sees back after submitting: the request and every line on it. */
export interface VenueBookingRequestOutcome {
  id: string;
  eventRequestId: string;
  venueId: string;
  lines: readonly VenueBookingRequestLine[];
}

// ---------------------------------------------------------------------------
// SCRUM-148 — Approve a booking request
// ---------------------------------------------------------------------------

export const VenueBookingRequestIdSchema = z.string().uuid();

/**
 * AC1 and AC5: a request's status, worked out from its lines (requestStatusOf
 * in policy.ts) rather than stored, so the request and its lines can never
 * disagree.
 */
export const VenueBookingRequestStatusEnum = z.enum(['pending', 'approved', 'partially_approved', 'rejected']);
export type VenueBookingRequestStatus = z.infer<typeof VenueBookingRequestStatusEnum>;

/**
 * SCRUM-150 AC1: another venue, date and period Venue Staff suggest when they
 * reject a line. All of them are given; the form starts them as the line's
 * own. A period, not slots, since SCRUM-239.
 */
export const SuggestionSchema = z
  .object({
    venueId: z.string().uuid('Choose a venue to suggest.'),
    date: z.string().refine(isISODate, 'Choose a date to suggest.'),
    start: z.string({ required_error: 'Choose a start time to suggest.' }).pipe(StartTimeSchema),
    end: z.string({ required_error: 'Choose an end time to suggest.' }).pipe(EndTimeSchema),
  })
  .superRefine((suggestion, ctx) => endAfterStart(suggestion, ctx, ['start', 'end']));
export type Suggestion = z.infer<typeof SuggestionSchema>;

/**
 * AC5: one decision for each pending line. A rejected line needs a reason; an
 * approved one doesn't take one.
 */
export const DecideVenueBookingRequestInputSchema = z.object({
  decisions: z
    .array(
      z.object({
        lineId: z.string().uuid('Each decision must name a line of this request.'),
        decision: z.enum(['approve', 'reject']),
        reason: z.string().optional(),
        suggestion: SuggestionSchema.optional(),
      }),
    )
    .min(1, 'Decide at least one line.')
    .refine((decisions) => new Set(decisions.map((d) => d.lineId)).size === decisions.length, 'Each line can only be decided once.')
    .refine(
      (decisions) => decisions.every((d) => d.decision === 'approve' || (d.reason ?? '').trim().length > 0),
      'A reason is required for each rejected line.',
    )
    .refine(
      (decisions) => decisions.every((d) => d.decision === 'reject' || d.suggestion === undefined),
      'A suggestion can only go with a rejected line.',
    ),
});
export type DecideVenueBookingRequestInput = z.infer<typeof DecideVenueBookingRequestInputSchema>;

/** AC1 and AC5: a line as decided: who decided, when, and why if rejected. */
export interface DecidedVenueBookingRequestLine {
  id: string;
  date: string;
  /** SCRUM-239: the requested period, `HH:MM`. A line from before the switch has its slots' times. */
  start: string;
  end: string;
  /**
   * The slots of a line requested before SCRUM-239 switched requests to
   * times; null for every line since. Only read to refuse approving AM + Night
   * as one period (see 20261012090000_booking_requests_in_time_ranges.sql).
   */
  legacySlots: readonly string[] | null;
  status: VenueBookingRequestLineStatus;
  decidedBy: string | null;
  /** The decider's name, for the page; null while pending or if the account has no name. */
  decidedByName: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  /** SCRUM-150 AC1: what Venue Staff suggested instead, on a rejected line; null if nothing. */
  suggestion: { venueId: string; venueName: string; date: string; start: string; end: string } | null;
}

/** A booking request with its status and decided lines. */
export interface VenueBookingDecision {
  id: string;
  eventRequestId: string;
  venueId: string;
  /** AC2: the event's assigned coordinator, the one the decision is for. */
  coordinatorId: string | null;
  status: VenueBookingRequestStatus;
  lines: readonly DecidedVenueBookingRequestLine[];
}

/**
 * AC3 and AC4: the dates a venue's calendar covers. A range of whole days,
 * from on or before to.
 */
export const VenueBookingRangeSchema = z
  .object({
    from: z.string({ required_error: 'from is required (YYYY-MM-DD).' }).refine(isISODate, 'from must be a date (YYYY-MM-DD).'),
    to: z.string({ required_error: 'to is required (YYYY-MM-DD).' }).refine(isISODate, 'to must be a date (YYYY-MM-DD).'),
  })
  .refine((range) => range.from <= range.to, 'from must be on or before to.');

/**
 * AC3 and AC4: one confirmed booking as a viewer may see it, at its exact
 * times (SCRUM-239). Venue Staff, the event's assigned coordinator and Event
 * Operations Managers see a confirmed booking with its event; any other
 * internal user sees only that the period is committed, with no event, client
 * or coordinator details.
 */
export type BookedPeriod =
  | { date: string; start: string; end: string; state: 'confirmed'; event: { id: string; reference: string; name: string } }
  | { date: string; start: string; end: string; state: 'committed' };

// ---------------------------------------------------------------------------
// SCRUM-147 — View the pending booking request queue
// ---------------------------------------------------------------------------
// One entry per pending line, not per request: each date-and-period line is
// decided on its own (SCRUM-148 AC5), so each one leaves the queue on its own.

/** AC1 — one row of the queue: venue, event, requested date and period (SCRUM-239), and when it was requested. */
export interface BookingQueueEntry {
  lineId: string;
  requestId: string;
  venueName: string;
  eventName: string;
  eventReference: string;
  /** The requested date, YYYY-MM-DD. */
  date: string;
  /** The requested period, `HH:MM` (SCRUM-239). */
  start: string;
  end: string;
  /** When the request was made (timestamptz). */
  requestedAt: string;
}

// ---------------------------------------------------------------------------
// SCRUM-143 — Include the requirements Venue Staff need
// ---------------------------------------------------------------------------

/**
 * What SCRUM-143 adds to SCRUM-148's decision page. That page already lists
 * each requested date and its period (AC1); this adds the event's reference and
 * the requesting coordinator (AC1), and the event's attendance, layout and
 * accessibility needs as recorded on the event (AC2). Values are as stored;
 * policy.ts says how a missing one reads (AC4).
 */
export interface BookingRequestRequirements {
  eventName: string;
  eventReference: string;
  /** Null when the coordinator's profile has no name recorded. */
  requestedByName: string | null;
  requestedAt: string;
  expectedAttendance: number | null;
  roomLayout: string | null;
  accessibilityRequired: boolean | null;
  accessibilityFeatures: readonly { name: string }[];
  accessibilityNotes: string | null;
}

// ---------------------------------------------------------------------------
// SCRUM-155 — Block approval of a conflicting booking
// ---------------------------------------------------------------------------

/**
 * What decide_venue_booking_request returns
 * (20261012090000_booking_requests_in_time_ranges.sql): the outcome, and the
 * other events' requests it rejected because a period is now committed (AC4).
 * 'unavailable' and 'held' are the database's own re-check, in case something
 * changed after the service's check; 'non_adjacent_slots' is a line from
 * before the switch to times asking for AM and Night as one period.
 */
export const DecisionResultSchema = z.object({
  outcome: z.enum(['decided', 'already_decided', 'incomplete', 'unavailable', 'held', 'non_adjacent_slots']),
  autoRejectedRequestIds: z.array(z.string().uuid()).default([]),
});
