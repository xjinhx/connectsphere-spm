import {
  CreateVenueBookingRequestInputSchema,
  DecideVenueBookingRequestInputSchema,
  DecisionResultSchema,
  EventRequestIdSchema,
  VenueBookingRangeSchema,
  VenueBookingRequestIdSchema,
  VenueBookingRequestLineStatusEnum,
  type BookedSlot,
  type VenueBookingDecision,
  type VenueBookingRequestOutcome,
} from './schema';
import {
  bookingDecisionMessage,
  canCreateBookingRequest,
  canSeeBookingDetails,
  canViewBookingRequest,
  describeApprovalConflict,
  findApprovalConflicts,
  requestStatusOf,
  slotCommittedMessage,
  SLOT_COMMITTED_REASON,
  type ApprovalConflict,
} from './policy';
import { isCurrentCoordinator } from '@/domain/assignment/policy';
import type { Role } from '@/domain/identity/roles';
import { notifyBestEffort } from '@/domain/notification/service';
import { getVenue } from '@/domain/venues/service';
import { fetchEventRequestById } from '@/lib/supabase/eventRequests';
import { fetchProfileNames } from '@/lib/supabase/profiles';
import type { EventRequestRow } from '@/lib/supabase/eventRequests';
import {
  createVenueBookingRequest,
  fetchVenueBookingRequestById,
  type VenueBookingRequestRow,
} from '@/lib/supabase/venueBookingRequests';
import {
  decideVenueBookingRequestLines,
  fetchConfirmedBookingsBetween,
  fetchUnavailableSlotsWithReasons,
  fetchVenueBookingDecision,
} from '@/lib/supabase/venueBookings';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  ForbiddenError,
  isUniqueViolation,
} from '@/domain/shared/errors';

const EVENT_NOT_APPROVED_MESSAGE =
  'The event must be approved before venue arrangements can begin.';

function toOutcome(row: VenueBookingRequestRow): VenueBookingRequestOutcome {
  return {
    id: row.id,
    eventRequestId: row.event_request_id,
    venueId: row.venue_id,
    lines: row.venue_booking_request_line.map((line) => ({
      id: line.id,
      date: line.date,
      timeSlots: line.time_slots,
      status: line.status,
    })),
  };
}

/**
 * SCRUM-142 AC1-AC4 — submit a venue booking request for an event.
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
    throw new ValidationError('The venue booking request is not valid.', parsedInput.error.flatten());
  }

  const { data: newRequestId, error: writeError } = await createVenueBookingRequest({
    eventRequestId: parsedId.data,
    venueId: parsedInput.data.venueId,
    requestedBy: actorId,
    lines: parsedInput.data.lines.map((line) => ({
      date: line.date.toISOString().slice(0, 10),
      timeSlots: line.timeSlots,
    })),
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

const SLOT_ORDER = ['am', 'pm', 'night'];
const DECIDE_EVERY_LINE = 'Decide every pending line of this request, and only those.';

type DecisionRow = {
  id: string;
  event_request_id: string;
  venue_id: string;
  event_request: { coordinator_id: string | null } | null;
  venue_booking_request_line: {
    id: string;
    date: string;
    time_slots: string[];
    status: string;
    decided_by: string | null;
    decided_at: string | null;
    rejection_reason: string | null;
  }[];
};

/** Lines in date order, then AM, PM, Night: the order the days run in. */
function toDecision(row: DecisionRow, deciderNames: ReadonlyMap<string, string | null>): VenueBookingDecision {
  const lines = [...row.venue_booking_request_line]
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        SLOT_ORDER.indexOf(a.time_slots[0] ?? '') - SLOT_ORDER.indexOf(b.time_slots[0] ?? ''),
    )
    .map((line) => ({
      id: line.id,
      date: line.date,
      timeSlots: line.time_slots,
      status: VenueBookingRequestLineStatusEnum.parse(line.status),
      decidedBy: line.decided_by,
      decidedByName: line.decided_by ? (deciderNames.get(line.decided_by) ?? null) : null,
      decidedAt: line.decided_at,
      rejectionReason: line.rejection_reason,
    }));

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
 * slot gets a confirmed booking (AC2), all in one transaction. The request's
 * status follows from its lines: Approved, Partially Approved or Rejected.
 *
 * AC1's "with no conflict" is SCRUM-155's: an approval that clashes with a
 * confirmed booking or an unavailable slot is refused, naming what it clashes
 * with, and approving a slot rejects other events' pending lines for it.
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

  // SCRUM-155 AC1 and AC5: refuse an approval that clashes, naming what with.
  // The database checks again inside the save, in case of a change in between.
  const approving = new Set(parsed.data.decisions.filter((d) => d.decision === 'approve').map((d) => d.lineId));
  const conflicts = await conflictsFor(current.venueId, current.lines.filter((line) => approving.has(line.id)));
  if (conflicts.length > 0) {
    throw new ConflictError(`This request cannot be approved. ${conflicts.map(describeApprovalConflict).join(' ')}`, {
      reason: 'slot_conflict',
      conflicts,
    });
  }

  const { data, error } = await decideVenueBookingRequestLines(requestId, parsed.data.decisions, actorId);
  if (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('One of these slots is already booked at this venue, so nothing was saved.', {
        reason: 'slot_already_booked',
      });
    }
    throw new ValidationError('The decision could not be saved.', error.message);
  }
  const result = DecisionResultSchema.parse(data);
  if (result.outcome === 'already_decided') throw alreadyDecided();
  if (result.outcome === 'unavailable') {
    throw new ConflictError('One of these slots has just been marked unavailable, so nothing was saved.', {
      reason: 'slot_unavailable',
    });
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

  // SCRUM-155 AC4: each other event whose pending line lost its slot to this
  // approval is told, through its coordinator.
  const booked = saved.lines.filter((line) => line.status === 'approved');
  for (const otherId of result.autoRejectedRequestIds) {
    const other = await readDecision(otherId);
    const lost = other.lines.filter(
      (line) =>
        line.rejectionReason === SLOT_COMMITTED_REASON &&
        booked.some((b) => b.date === line.date && b.timeSlots.some((slot) => line.timeSlots.includes(slot))),
    );
    if (other.coordinatorId && lost.length > 0) {
      await notifyBestEffort({
        recipientId: other.coordinatorId,
        type: 'venue_booking_update',
        eventRequestId: other.eventRequestId,
        message: slotCommittedMessage(venue.name, lost),
      });
    }
  }
  return saved;
}

/**
 * SCRUM-155 AC1 and AC5: what these lines' slots clash with at the venue:
 * confirmed bookings, with their event, and slots recorded as unavailable,
 * with the reason.
 *
 * AC3: a booking that has been released or cancelled is no longer confirmed,
 * so it no longer clashes and the approval goes through.
 * DUMMY(SCRUM-105) D-15: nothing releases or cancels a single booking yet;
 * testers remove it by hand.
 */
async function conflictsFor(
  venueId: string,
  lines: readonly { id: string; date: string; timeSlots: readonly string[] }[],
): Promise<ApprovalConflict[]> {
  const dates = [...new Set(lines.map((line) => line.date))].sort();
  const from = dates[0];
  const to = dates[dates.length - 1];
  if (!from || !to) return [];

  const [bookings, unavailable] = await Promise.all([
    fetchConfirmedBookingsBetween(venueId, from, to),
    fetchUnavailableSlotsWithReasons(venueId, dates),
  ]);
  if (bookings.error || !bookings.data || unavailable.error || !unavailable.data) {
    throw new ValidationError('Could not check the venue for clashes.', bookings.error?.message ?? unavailable.error?.message);
  }
  return findApprovalConflicts(
    lines,
    bookings.data.map((b) => ({
      date: b.date,
      slot: b.slot,
      event: b.event_request ? { reference: b.event_request.reference, name: b.event_request.name } : null,
    })),
    unavailable.data,
  );
}

/**
 * SCRUM-155 AC2: what each pending line of a request clashes with, for the
 * decision page. A line that clashes is shown with no Approve option, and stays
 * Pending until it is rejected or the clash goes away.
 */
export async function findPendingLineConflicts(decision: VenueBookingDecision): Promise<ApprovalConflict[]> {
  return conflictsFor(decision.venueId, decision.lines.filter((line) => line.status === 'pending'));
}

/**
 * SCRUM-148 AC3 and AC4: a venue's booked slots from `from` to `to`, as this
 * viewer may see them (canSeeBookingDetails). The calendar page itself is
 * SCRUM-123's; this is the data it shows.
 *
 * Who may call it at all (internal staff, venue_catalogue_view) is checked by
 * the route.
 */
export async function listVenueBookings(
  venueId: string,
  range: unknown,
  actor: { userId: string; roles: readonly Role[] },
): Promise<BookedSlot[]> {
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
    .map((row): BookedSlot => {
      const event = row.event_request;
      if (event && canSeeBookingDetails(actor, event.coordinator_id)) {
        return {
          date: row.date,
          slot: row.slot,
          state: 'confirmed',
          event: { id: event.id, reference: event.reference, name: event.name },
        };
      }
      return { date: row.date, slot: row.slot, state: 'committed' };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
}
