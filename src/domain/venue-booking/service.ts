import {
  CreateVenueBookingRequestInputSchema,
  DecideVenueBookingRequestInputSchema,
  DecisionResultSchema,
  EventRequestIdSchema,
  ReleaseVenueBookingInputSchema,
  VenueBookingIdSchema,
  VenueBookingRangeSchema,
  VenueBookingRequestIdSchema,
  VenueBookingRequestLineStatusEnum,
  VenueBookingStatusEnum,
  lineErrorsFrom,
  venueBookingRequestErrorDetails,
  type BookedPeriod,
  type BookingQueueEntry,
  type BookingRequestRequirements,
  type DecidedVenueBookingRequestLine,
  type EventVenueBooking,
  type VenueBookingDecision,
  type VenueBookingRequestOutcome,
} from './schema';
import {
  approvalConflictsFor,
  bookingDecisionMessage,
  canCreateBookingRequest,
  canSeeBookingDetails,
  canViewBookingRequest,
  describeApprovalConflict,
  describePeriodClashes,
  isOutsideOpeningHours,
  outsideOpeningHoursMessage,
  overlappingLines,
  OVERLAPPING_LINES_MESSAGE,
  PERIOD_COMMITTED_REASON,
  legacySuggestionPeriods,
  periodClashFieldMessage,
  periodCommittedMessage,
  requestStatusOf,
  sortBookingQueue,
  type ApprovalConflict,
  type BookingQueueSort,
  type PeriodClash,
} from './policy';
import { isCurrentCoordinator } from '@/domain/assignment/policy';
import { getVenueCommitments } from '@/domain/availability/service';
import { toCommittedPeriods } from '@/domain/availability/policy';
import type { Role } from '@/domain/identity/roles';
import { notifyBestEffort } from '@/domain/notification/service';
import { fromDatabaseTime, rangesOverlap } from '@/domain/shared/times';
import { withoutOwnHolds } from '@/domain/venue-hold/policy';
import { getVenue } from '@/domain/venues/service';
import { fetchEventRequestById } from '@/lib/supabase/eventRequests';
import { fetchProfileNames } from '@/lib/supabase/profiles';
import { fetchEventNames } from '@/lib/supabase/venueHolds';
import { fetchVenueOpeningHours } from '@/lib/supabase/venues';
import type { EventRequestRow } from '@/lib/supabase/eventRequests';
import {
  createVenueBookingRequest,
  fetchBookingRequestRequirements,
  fetchPendingBookingLines,
  fetchVenueBookingRequestById,
  type BookingRequestRequirementsRow,
  type PendingBookingLineRow,
  type VenueBookingRequestRow,
} from '@/lib/supabase/venueBookingRequests';
import {
  decideVenueBookingRequestLines,
  fetchConfirmedBookingsBetween,
  fetchEventVenueBookings,
  fetchVenueBookingDecision,
  fetchVenueBookingForRelease,
  releaseConfirmedVenueBooking,
} from '@/lib/supabase/venueBookings';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  ForbiddenError,
  isExclusionViolation,
} from '@/domain/shared/errors';

const EVENT_NOT_APPROVED_MESSAGE =
  'The event must be approved before venue arrangements can begin.';

const RETIRED_VENUE_MESSAGE = 'This venue is retired, so it cannot be requested.';

function toOutcome(row: VenueBookingRequestRow): VenueBookingRequestOutcome {
  return {
    id: row.id,
    eventRequestId: row.event_request_id,
    venueId: row.venue_id,
    lines: row.venue_booking_request_line.map((line) => ({
      id: line.id,
      date: line.date,
      start: fromDatabaseTime(line.start_time),
      end: fromDatabaseTime(line.end_time),
      status: line.status,
    })),
  };
}

type RequestedLine = { date: string; start: string; end: string };

/** A refusal whose details name the field on each line, the same shape as AC5's (venueBookingRequestErrorDetails). */
function lineDetails(issues: { path: (string | number)[]; message: string }[]) {
  return { formErrors: [], fieldErrors: {}, lineErrors: lineErrorsFrom(issues) };
}

/**
 * SCRUM-239 AC1 (request part): every requested period must sit inside the
 * venue's opening hours. A period outside them is refused, and the line's
 * times say why.
 */
async function refuseOutsideOpeningHours(venueId: string, lines: readonly RequestedLine[]): Promise<void> {
  const { data, error } = await fetchVenueOpeningHours(venueId);
  if (error || !data) {
    throw new ValidationError("Could not check the venue's opening hours.", error?.message);
  }
  const hours = { opensAt: fromDatabaseTime(data.opens_at), closesAt: fromDatabaseTime(data.closes_at) };
  const outside = lines.flatMap((line, index) => (isOutsideOpeningHours(line, hours) ? [index] : []));
  if (outside.length === 0) return;

  const message = outsideOpeningHoursMessage(hours);
  throw new ValidationError(
    `This venue cannot be requested for that time. ${message}`,
    lineDetails(outside.flatMap((index) => [{ path: [index, 'start'], message }, { path: [index, 'end'], message }])),
  );
}

/**
 * SCRUM-239 AC3 and AC8 (SCRUM-154 in time ranges): refuse a request whose
 * period overlaps one that is committed at the venue: a confirmed booking
 * (AC3), an unavailable period (AC8) or another event's active hold
 * (SCRUM-227 AC3). The event's own holds are left out (SCRUM-227 AC5), so an
 * event can request what is held for it. A pending request commits nothing.
 *
 * The refusal names each clashing period and nothing else (AC3: "without any
 * other event's details"): toCommittedPeriods keeps the date and times only.
 * Ranges are half-open, so a request starting as a booking ends is not a
 * clash (AC2's rule).
 *
 * Asked of getVenueCommitments, the one availability check agreed on day 1,
 * so setup and turnaround (SCRUM-226) apply here once they join it.
 *
 * This is a check at request time, not a lock: a booking confirmed a moment
 * later is still caught when Venue Staff approve (AC4), and by
 * venue_booking_no_overlap in the database.
 */
async function refuseClashingPeriods(
  venueId: string,
  eventRequestId: string,
  lines: readonly RequestedLine[],
): Promise<void> {
  const committedPerLine = await Promise.all(
    lines.map(async (line) =>
      toCommittedPeriods(
        withoutOwnHolds(
          await getVenueCommitments(venueId, `${line.date}T${line.start}`, `${line.date}T${line.end}`),
          eventRequestId,
        ),
      ),
    ),
  );

  const clashes: PeriodClash[] = lines.flatMap((line, lineIndex) => {
    const committed = committedPerLine[lineIndex] ?? [];
    return committed.length > 0 ? [{ lineIndex, ...line, committed }] : [];
  });
  if (clashes.length === 0) return;

  throw new ConflictError(describePeriodClashes(clashes), {
    reason: 'period_clash',
    clashes,
    ...lineDetails(clashes.map((clash) => ({ path: [clash.lineIndex, 'start'], message: periodClashFieldMessage(clash) }))),
  });
}

/**
 * SCRUM-142 AC1-AC4 — submit a venue booking request for an event, and
 * SCRUM-239 AC1, AC3 and AC8 — in exact start and end times.
 *
 * `actorId` is the assigned coordinator submitting it, supplied by the route
 * from the signed-in session — never chosen by whoever sends the request,
 * the same convention as approveEventRequest (SCRUM-92).
 */
export async function submitVenueBookingRequest(
  eventRequestId: string,
  actorId: string,
  input: unknown,
): Promise<VenueBookingRequestOutcome> {
  const parsedId = EventRequestIdSchema.safeParse(eventRequestId);
  if (!parsedId.success) throw new NotFoundError('Event request');

  const { data: existing, error: readError } = await fetchEventRequestById(parsedId.data);
  if (readError) {
    throw new ValidationError('The event request could not be read.', readError.message);
  }
  if (!existing) throw new NotFoundError('Event request');

  const event = existing as unknown as EventRequestRow;

  // AC4 — refused before AC2's status check, the same ordering
  // approveEventRequest uses for its own assigned-coordinator check: a
  // coordinator this event is not assigned to should learn nothing about it,
  // not even whether it is approved yet.
  if (!isCurrentCoordinator(event.coordinator_id, actorId)) {
    throw new ForbiddenError('This event is not assigned to you.');
  }

  // AC2
  if (!canCreateBookingRequest(event.status)) {
    throw new ValidationError(EVENT_NOT_APPROVED_MESSAGE);
  }

  // AC5 — only reached for the assigned coordinator of an approved event, so
  // an unapproved event is always told it must be approved first (AC2), never
  // which fields are missing.
  const parsedInput = CreateVenueBookingRequestInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new ValidationError('The venue booking request is not valid.', venueBookingRequestErrorDetails(parsedInput.error));
  }

  const lines: RequestedLine[] = parsedInput.data.lines.map((line) => ({
    date: line.date.toISOString().slice(0, 10),
    start: line.start,
    end: line.end,
  }));

  // Two lines of the same request that overlap could never both be booked.
  const overlapping = overlappingLines(lines);
  if (overlapping.length > 0) {
    throw new ValidationError(
      'The venue booking request is not valid.',
      lineDetails(overlapping.map((index) => ({ path: [index, 'start'], message: OVERLAPPING_LINES_MESSAGE }))),
    );
  }

  // TC-142-10 — a retired venue can't host a new event (SCRUM-121 AC3). The
  // form only lists active venues, so this catches a direct API call. Throws
  // NotFoundError for a venue that does not exist.
  const venue = await getVenue(parsedInput.data.venueId);
  if (venue.isRetired) {
    throw new ValidationError(RETIRED_VENUE_MESSAGE, {
      formErrors: [],
      fieldErrors: { venueId: [RETIRED_VENUE_MESSAGE] },
      lineErrors: [],
    });
  }

  // SCRUM-239 AC1, then AC3 and AC8 — after the field checks, so a request
  // that is missing fields is told so first, and before anything is written.
  await refuseOutsideOpeningHours(venue.id, lines);
  await refuseClashingPeriods(venue.id, parsedId.data, lines);

  const { data: newRequestId, error: writeError } = await createVenueBookingRequest({
    eventRequestId: parsedId.data,
    venueId: parsedInput.data.venueId,
    requestedBy: actorId,
    lines,
  });

  if (writeError || !newRequestId) {
    throw new ValidationError('The venue booking request could not be created.', writeError?.message);
  }

  const { data: created, error: rereadError } = await fetchVenueBookingRequestById(newRequestId);
  if (rereadError) {
    throw new ValidationError('The venue booking request could not be read back.', rereadError.message);
  }
  // Written a moment ago by the statement above — a missing row here means
  // something else deleted it in between, not that creation failed.
  if (!created) throw new NotFoundError('Venue booking request');

  // This function's job ends here: the request and its lines exist. The
  // event's own status reacts to the new row (SCRUM-101 AC3/AC4, Approved ->
  // Planning) through a database trigger on venue_booking_request, in the
  // same transaction as the insert — nothing to call from here.

  return toOutcome(created as unknown as VenueBookingRequestRow);
}

// ---------------------------------------------------------------------------
// SCRUM-148 — Approve a booking request
// ---------------------------------------------------------------------------

const DECIDE_EVERY_LINE = 'Decide every pending line of this request, and only those.';

type DecisionRow = {
  id: string;
  event_request_id: string;
  venue_id: string;
  event_request: { coordinator_id: string | null } | null;
  venue_booking_request_line: {
    id: string;
    date: string;
    start_time: string;
    end_time: string;
    time_slots: string[] | null;
    status: string;
    decided_by: string | null;
    decided_at: string | null;
    rejection_reason: string | null;
    suggested_venue_id: string | null;
    suggested_date: string | null;
    suggested_start_time: string | null;
    suggested_end_time: string | null;
    suggested_slots: string[] | null;
    suggested_venue: { name: string } | null;
  }[];
};

/**
 * SCRUM-150 AC1: a rejected line's suggestion. One made before the switch to
 * times for AM and Night (no PM) has no period of its own and is shown as its
 * two slots' periods (legacySuggestionPeriods).
 */
function toSuggestion(line: DecisionRow['venue_booking_request_line'][number]): DecidedVenueBookingRequestLine['suggestion'] {
  if (!line.suggested_venue_id || !line.suggested_date) return null;
  const periods =
    line.suggested_start_time && line.suggested_end_time
      ? [{ start: fromDatabaseTime(line.suggested_start_time), end: fromDatabaseTime(line.suggested_end_time) }]
      : legacySuggestionPeriods(line.suggested_slots ?? []);
  if (periods.length === 0) return null;
  return {
    venueId: line.suggested_venue_id,
    venueName: line.suggested_venue?.name ?? 'Venue',
    date: line.suggested_date,
    periods,
  };
}

/** Lines in date order, then start time: the order the days run in. */
function toDecision(row: DecisionRow, deciderNames: ReadonlyMap<string, string | null>): VenueBookingDecision {
  const lines = [...row.venue_booking_request_line]
    .sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time))
    .map(
      (line): DecidedVenueBookingRequestLine => ({
        id: line.id,
        date: line.date,
        start: fromDatabaseTime(line.start_time),
        end: fromDatabaseTime(line.end_time),
        legacySlots: line.time_slots,
        status: VenueBookingRequestLineStatusEnum.parse(line.status),
        decidedBy: line.decided_by,
        decidedByName: line.decided_by ? (deciderNames.get(line.decided_by) ?? null) : null,
        decidedAt: line.decided_at,
        rejectionReason: line.rejection_reason,
        suggestion: toSuggestion(line),
      }),
    );

  return {
    id: row.id,
    eventRequestId: row.event_request_id,
    venueId: row.venue_id,
    coordinatorId: row.event_request?.coordinator_id ?? null,
    status: requestStatusOf(lines.map((line) => line.status)),
    lines,
  };
}

async function readDecision(requestId: string): Promise<VenueBookingDecision> {
  const { data, error } = await fetchVenueBookingDecision(requestId);
  if (error) {
    throw new ValidationError('The venue booking request could not be read.', error.message);
  }
  if (!data) throw new NotFoundError('Venue booking request');
  const row = data as DecisionRow;
  return toDecision(row, await readDeciderNames(row));
}

/** AC1: who decided each line, by name, so the decision page can show it. */
async function readDeciderNames(row: DecisionRow): Promise<Map<string, string | null>> {
  const ids = [...new Set(row.venue_booking_request_line.flatMap((line) => (line.decided_by ? [line.decided_by] : [])))];
  if (ids.length === 0) return new Map();
  const { data, error } = await fetchProfileNames(ids);
  if (error) {
    throw new ValidationError('The venue booking request could not be read.', error.message);
  }
  return new Map((data ?? []).map((profile) => [profile.id, profile.full_name]));
}

function alreadyDecided(): ConflictError {
  return new ConflictError('This booking request has already been decided.', { reason: 'already_decided' });
}

/** A booking request with its status and each line's decision, for Venue Staff. */
export async function getVenueBookingDecision(requestId: string): Promise<VenueBookingDecision> {
  if (!VenueBookingRequestIdSchema.safeParse(requestId).success) {
    throw new NotFoundError('Venue booking request');
  }
  return readDecision(requestId);
}

/**
 * SCRUM-149 AC3: a booking request for someone allowed to open it: Venue Staff,
 * or the event's assigned coordinator, who sees each rejected line's reason and
 * who decided it (canViewBookingRequest). The page and the API route both use
 * this, so they can never disagree about who may look.
 */
export async function viewVenueBookingRequest(
  requestId: string,
  actor: { userId: string; roles: readonly Role[] },
): Promise<VenueBookingDecision> {
  const decision = await getVenueBookingDecision(requestId);
  if (!canViewBookingRequest(actor, decision.coordinatorId)) {
    throw new ForbiddenError("Only Venue Staff and the event's coordinator can view this booking request.");
  }
  return decision;
}

/**
 * SCRUM-148 AC1, AC2 and AC5: decide every pending line of a booking request.
 *
 * Each line is approved or rejected on its own, a rejected line with a reason
 * (AC5). Every line records who decided and when (AC1), and every approved
 * line's period gets a confirmed booking (AC2), all in one transaction. The
 * request's status follows from its lines: Approved, Partially Approved or
 * Rejected.
 *
 * AC1's "with no conflict" is SCRUM-155's, in time ranges since SCRUM-239
 * AC4: an approval that overlaps a confirmed booking, another event's active
 * hold or an unavailable period is refused, naming what it clashes with, and
 * approving a period rejects other events' pending lines that overlap it.
 *
 * Who may decide is checked by the route (venue_administration, Venue
 * Staff's); the decider is the signed-in account, never an id from the body.
 *
 * SCRUM-149 AC1 and AC2 are this same decision: rejecting every line of a
 * request makes it Rejected, and each rejected line needs a reason.
 *
 * "The assigned Event Coordinator is notified" (SCRUM-148 AC2) and "the
 * coordinator is notified" (SCRUM-149 AC1): once the decision is saved, the
 * coordinator gets a SCRUM-193 notification with the outcome and each
 * rejected line's reason. Best effort, like SCRUM-198's: a notification that
 * fails is logged and never undoes a saved decision.
 */
export async function decideVenueBookingRequest(
  requestId: string,
  actorId: string,
  input: unknown,
): Promise<VenueBookingDecision> {
  if (!VenueBookingRequestIdSchema.safeParse(requestId).success) {
    throw new NotFoundError('Venue booking request');
  }
  const parsed = DecideVenueBookingRequestInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'The decision is not valid.', parsed.error.flatten());
  }

  const current = await readDecision(requestId);
  const pending = new Set(current.lines.filter((line) => line.status === 'pending').map((line) => line.id));
  if (pending.size === 0) throw alreadyDecided();

  const decided = parsed.data.decisions.map((d) => d.lineId);
  if (decided.length !== pending.size || decided.some((id) => !pending.has(id))) {
    throw new ValidationError(DECIDE_EVERY_LINE);
  }

  // SCRUM-239 AC4 (SCRUM-155 AC1 and AC5 in time ranges): refuse an approval
  // that overlaps a committed period, naming it and the event holding it.
  // The database checks again inside the save, in case of a change in between.
  const approving = new Set(parsed.data.decisions.filter((d) => d.decision === 'approve').map((d) => d.lineId));
  const conflicts = await conflictsFor(
    current.venueId,
    current.eventRequestId,
    current.lines.filter((line) => approving.has(line.id)),
  );
  if (conflicts.length > 0) {
    throw new ConflictError(`This request cannot be approved. ${conflicts.map(describeApprovalConflict).join(' ')}`, {
      reason: 'period_conflict',
      conflicts,
    });
  }

  const { data, error } = await decideVenueBookingRequestLines(requestId, parsed.data.decisions, actorId);
  if (error) {
    // venue_booking_no_overlap: a booking confirmed between the check above and the save.
    if (isExclusionViolation(error)) {
      throw new ConflictError('One of these periods has just been booked at this venue, so nothing was saved.', {
        reason: 'period_already_booked',
      });
    }
    throw new ValidationError('The decision could not be saved.', error.message);
  }
  const result = DecisionResultSchema.parse(data);
  if (result.outcome === 'already_decided') throw alreadyDecided();
  if (result.outcome === 'unavailable') {
    throw new ConflictError('One of these periods has just been marked unavailable, so nothing was saved.', {
      reason: 'period_unavailable',
    });
  }
  if (result.outcome === 'held') {
    throw new ConflictError('One of these periods has just been held for another event, so nothing was saved.', {
      reason: 'period_held',
    });
  }
  if (result.outcome === 'non_adjacent_slots') {
    throw new ConflictError(
      'A line requested as AM and Night cannot be booked as one period, so nothing was saved. Reject it instead.',
      { reason: 'non_adjacent_slots' },
    );
  }
  if (result.outcome !== 'decided') throw new ValidationError(DECIDE_EVERY_LINE);

  const saved = await readDecision(requestId);
  const venue = await getVenue(saved.venueId);
  if (saved.coordinatorId) {
    await notifyBestEffort({
      recipientId: saved.coordinatorId,
      type: 'venue_booking_update',
      eventRequestId: saved.eventRequestId,
      message: bookingDecisionMessage(venue.name, saved),
    });
  }

  // SCRUM-155 AC4: each other event whose pending line overlapped a period
  // this approval booked is told, through its coordinator. Only lines this
  // approval rejected carry PERIOD_COMMITTED_REASON: one rejected before
  // PR #100 has the old "This slot is committed..." reason, and was already
  // told when it was rejected, so it is rightly left out here.
  const booked = saved.lines.filter((line) => line.status === 'approved');
  for (const otherId of result.autoRejectedRequestIds) {
    const other = await readDecision(otherId);
    const lost = other.lines.filter(
      (line) =>
        line.rejectionReason === PERIOD_COMMITTED_REASON &&
        booked.some((b) => b.date === line.date && rangesOverlap(b, line)),
    );
    if (other.coordinatorId && lost.length > 0) {
      await notifyBestEffort({
        recipientId: other.coordinatorId,
        type: 'venue_booking_update',
        eventRequestId: other.eventRequestId,
        message: periodCommittedMessage(venue.name, lost),
      });
    }
  }
  return saved;
}

/**
 * SCRUM-239 AC4 (SCRUM-155 AC1 and AC5 in time ranges): what each of these
 * lines would clash with at the venue, from getVenueCommitments: confirmed
 * bookings and other events' active holds, each with its event, and
 * unavailable periods, with the reason. The event's own holds are left out
 * (SCRUM-227 AC5): approving the holder's request books what it held, and the
 * database closes the hold. A line from before the switch to times asking for
 * AM and Night is refused as well (isNonAdjacentSlots).
 *
 * SCRUM-155 AC3: a booking that has been released (SCRUM-231) or cancelled is
 * no longer confirmed, so getVenueCommitments no longer returns it and the
 * approval goes through.
 * DUMMY(SCRUM-105) D-15: nothing cancels an event's bookings yet; testers
 * remove the booking by hand for the cancelled case.
 */
async function conflictsFor(
  venueId: string,
  eventRequestId: string,
  lines: readonly DecidedVenueBookingRequestLine[],
): Promise<ApprovalConflict[]> {
  if (lines.length === 0) return [];
  const committedPerLine = await Promise.all(
    lines.map(async (line) =>
      withoutOwnHolds(
        await getVenueCommitments(venueId, `${line.date}T${line.start}`, `${line.date}T${line.end}`),
        eventRequestId,
      ),
    ),
  );

  // Venue Staff may see which event holds a clash (SCRUM-155 AC1).
  const eventIds = [...new Set(committedPerLine.flat().flatMap((c) => (c.eventRequestId ? [c.eventRequestId] : [])))];
  const events = new Map<string, { reference: string; name: string }>();
  if (eventIds.length > 0) {
    const { data, error } = await fetchEventNames(eventIds);
    if (error || !data) throw new ValidationError('Could not check the venue for clashes.', error?.message);
    for (const row of data) events.set(row.id, { reference: row.reference, name: row.name });
  }

  return lines.flatMap((line, index) => approvalConflictsFor(line, committedPerLine[index] ?? [], events));
}

/**
 * SCRUM-155 AC2: what each pending line of a request clashes with, for the
 * decision page. A line that clashes is shown with no Approve option, and stays
 * Pending until it is rejected or the clash goes away.
 */
export async function findPendingLineConflicts(decision: VenueBookingDecision): Promise<ApprovalConflict[]> {
  return conflictsFor(
    decision.venueId,
    decision.eventRequestId,
    decision.lines.filter((line) => line.status === 'pending'),
  );
}

/**
 * SCRUM-148 AC3 and AC4: a venue's confirmed bookings from `from` to `to`, at
 * their exact times (SCRUM-239), as this viewer may see them
 * (canSeeBookingDetails). The calendar (SCRUM-239 AC5) attaches the event to a
 * Confirmed period only where this returns it.
 *
 * Who may call it at all (internal staff, venue_catalogue_view) is checked by
 * the route.
 */
export async function listVenueBookings(
  venueId: string,
  range: unknown,
  actor: { userId: string; roles: readonly Role[] },
): Promise<BookedPeriod[]> {
  const parsed = VenueBookingRangeSchema.safeParse(range);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'The date range is not valid.', parsed.error.flatten());
  }

  // Throws NotFoundError for a venue that does not exist.
  const venue = await getVenue(venueId);

  const { data, error } = await fetchConfirmedBookingsBetween(venue.id, parsed.data.from, parsed.data.to);
  if (error || !data) {
    throw new ValidationError("Could not load the venue's bookings.", error?.message);
  }

  return data
    .map((row): BookedPeriod => {
      const period = { date: row.date, start: fromDatabaseTime(row.start_time), end: fromDatabaseTime(row.end_time) };
      const event = row.event_request;
      if (event && canSeeBookingDetails(actor, event.coordinator_id)) {
        return { ...period, state: 'confirmed', event: { id: event.id, reference: event.reference, name: event.name } };
      }
      return { ...period, state: 'committed' };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}

// ---------------------------------------------------------------------------
// SCRUM-147 — View the pending booking request queue
// ---------------------------------------------------------------------------

function toQueueEntry(row: PendingBookingLineRow): BookingQueueEntry {
  const request = row.venue_booking_request;
  // Postgres guarantees each line has a request, venue and event (NOT NULL
  // foreign keys); the generated embed types cannot say so.
  if (!request?.venues || !request.event_request) {
    throw new ValidationError('A booking request line is missing its request, venue or event.', { lineId: row.id });
  }
  return {
    lineId: row.id,
    requestId: request.id,
    venueName: request.venues.name,
    eventName: request.event_request.name,
    eventReference: request.event_request.reference,
    date: row.date,
    start: fromDatabaseTime(row.start_time),
    end: fromDatabaseTime(row.end_time),
    requestedAt: request.created_at,
  };
}

/**
 * SCRUM-147 AC1, AC3, AC4 — every pending line, at every venue, in the order
 * `sort` asks for (sortBookingQueue, policy.ts).
 *
 * Who may see it (Venue Staff, venue_administration) is checked by the page
 * before this is called, the same split as listVenues (SCRUM-121).
 */
export async function listPendingBookingQueue(sort: BookingQueueSort = 'requested'): Promise<BookingQueueEntry[]> {
  const { data, error } = await fetchPendingBookingLines();
  if (error || !data) {
    throw new ValidationError('Could not load the booking request queue.', error?.message);
  }
  const entries = (data as unknown as PendingBookingLineRow[]).map(toQueueEntry);
  return sortBookingQueue(entries, sort);
}

// ---------------------------------------------------------------------------
// SCRUM-143 — Include the requirements Venue Staff need
// ---------------------------------------------------------------------------

/**
 * SCRUM-143 AC1, AC2 — what Venue Staff need to assess a booking request,
 * shown on SCRUM-148's decision page next to the requested dates and periods:
 * the event's reference, who requested it and when, and the event's
 * attendance, layout and accessibility needs as recorded on the event.
 *
 * Who may see it (Venue Staff, venue_administration) is checked by the page
 * before this is called, the same as the decision itself.
 */
export async function getBookingRequestRequirements(requestId: string): Promise<BookingRequestRequirements> {
  if (!VenueBookingRequestIdSchema.safeParse(requestId).success) {
    throw new NotFoundError('Venue booking request');
  }
  const { data, error } = await fetchBookingRequestRequirements(requestId);
  if (error) throw new ValidationError('The venue booking request could not be read.', error.message);
  if (!data) throw new NotFoundError('Venue booking request');

  const row = data as unknown as BookingRequestRequirementsRow;
  const event = row.event_request;
  // NOT NULL foreign key: a request always has an event.
  if (!event) throw new ValidationError('A booking request is missing its event.', { requestId: row.id });

  const { data: requester, error: requesterError } = await fetchProfileNames([row.requested_by]);
  if (requesterError) {
    throw new ValidationError('The requesting coordinator could not be read.', requesterError.message);
  }

  return {
    eventName: event.name,
    eventReference: event.reference,
    requestedByName: requester?.[0]?.full_name ?? null,
    requestedAt: row.created_at,
    expectedAttendance: event.expected_attendance,
    roomLayout: event.room_layout,
    accessibilityRequired: event.accessibility_required,
    accessibilityFeatures: event.event_request_accessibility_features.flatMap((link) =>
      link.accessibility_features ? [{ name: link.accessibility_features.name }] : [],
    ),
    accessibilityNotes: event.accessibility_notes,
  };
}

// ---------------------------------------------------------------------------
// SCRUM-231 — Release one venue booking without affecting the event's others
// ---------------------------------------------------------------------------

type EventVenueBookingRow = {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
  release_reason: string | null;
  venue: { name: string } | null;
  event_request: { coordinator_id: string | null } | null;
};

/**
 * AC1, AC2: the event's venue bookings, confirmed and released, for its event
 * page. canRelease marks the ones the viewer may release (AC3): still
 * confirmed, and the viewer is the event's assigned coordinator.
 *
 * No access check of its own, the same as listAffectedBookings (SCRUM-151):
 * its only caller is the coordinator's review page, which calls it after
 * getReviewDetail has refused anyone the request is not theirs to see.
 */
export async function listEventVenueBookings(eventRequestId: string, actorId: string): Promise<EventVenueBooking[]> {
  const { data, error } = await fetchEventVenueBookings(eventRequestId);
  if (error || !data) throw new ValidationError("Could not read the event's venue bookings.", error?.message);

  return (data as unknown as EventVenueBookingRow[]).map((row) => {
    const status = VenueBookingStatusEnum.parse(row.status);
    return {
      id: row.id,
      venueName: row.venue?.name ?? 'Unknown venue',
      date: row.date,
      // Postgres `time` (10:00:00) as a clock time (10:00).
      startTime: row.start_time.slice(0, 5),
      endTime: row.end_time.slice(0, 5),
      status,
      releaseReason: row.release_reason,
      canRelease: status === 'confirmed' && isCurrentCoordinator(row.event_request?.coordinator_id ?? null, actorId),
    };
  });
}

/**
 * AC1: the event's assigned coordinator releases one booking, giving a
 * reason. It becomes Released and its time is free again, because everything
 * that treats a venue as committed reads confirmed bookings only (migration
 * 20261012100000). AC2: nothing else changes, not the event, its status or
 * its other bookings. AC4: an affected booking's outstanding action closes for
 * the same reason, since affected_booking_slot lists confirmed bookings only.
 *
 * `actorId` is whoever is signed in, from the route, never from the body.
 */
export async function releaseVenueBooking(bookingId: string, actorId: string, input: unknown): Promise<void> {
  if (!VenueBookingIdSchema.safeParse(bookingId).success) throw new NotFoundError('Venue booking');

  const { data, error } = await fetchVenueBookingForRelease(bookingId);
  if (error) throw new ValidationError('The venue booking could not be read.', error.message);
  if (!data) throw new NotFoundError('Venue booking');

  // AC3: checked before the reason, so a coordinator the event is not
  // assigned to learns nothing more about the booking. The same order as
  // submitVenueBookingRequest.
  const coordinatorId = (data as unknown as Pick<EventVenueBookingRow, 'event_request'>).event_request?.coordinator_id ?? null;
  if (!isCurrentCoordinator(coordinatorId, actorId)) {
    throw new ForbiddenError('This event is not assigned to you.');
  }

  const parsed = ReleaseVenueBookingInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'The release is not valid.', parsed.error.flatten());
  }

  const { data: released, error: releaseError } = await releaseConfirmedVenueBooking(bookingId, {
    reason: parsed.data.reason,
    releasedBy: actorId,
  });
  if (releaseError) throw new ValidationError('The venue booking could not be released.', releaseError.message);
  if (!released) throw new ConflictError('This booking has already been released.');
}
