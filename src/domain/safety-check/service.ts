import { z } from 'zod';
import type { Role } from '@/domain/identity/roles';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, isCheckViolation } from '@/domain/shared/errors';
import { fromDatabaseTime } from '@/domain/shared/times';
import { RoomLayoutSchema } from '@/domain/venues/schema';
import {
  NOT_SPECIFIED,
  describeAccessibilityForVenueStaff,
  describeAttendanceForVenueStaff,
  describeLayoutForVenueStaff,
  venueRequirementsOf,
} from '@/domain/venue-booking/policy';
import { fetchAccountEmail } from '@/lib/supabase/assignments';
import { fetchEquipmentRequest, fetchEquipmentRequestLines } from '@/lib/supabase/equipmentRequests';
import { fetchEventRequestById, type EventRequestRow } from '@/lib/supabase/eventRequests';
import { fetchProfileNames } from '@/lib/supabase/profiles';
import {
  fetchConfirmedBookingsForSafetyCheck,
  fetchEventsAwaitingSafetyCheck,
  fetchSafetyChecks,
  recordSafetyCheck,
} from '@/lib/supabase/safetyChecks';
import {
  NOT_AWAITING_CHECK_MESSAGE,
  STATUS_AFTER_DECISION,
  canRunSafetyCheck,
  canViewSafetyOutcome,
  isAwaitingSafetyCheck,
} from './policy';
import {
  RecordSafetyCheckInputSchema,
  RecordSafetyCheckOutcomeSchema,
  SafetyCheckQueueItemSchema,
  SafetyCheckRecordSchema,
  SafetyCheckViewSchema,
  type RecordSafetyCheckOutcome,
  type SafetyCheckQueueItem,
  type SafetyCheckRecord,
  type SafetyCheckVenue,
  type SafetyCheckView,
} from './schema';

/**
 * Operational safety check service (SCRUM-234 Run the Operational Safety
 * Check).
 *
 * Orchestration only: queries live in src/lib/supabase/safetyChecks.ts, the
 * rules in policy.ts, single-field rules in schema.ts. The acting account is
 * the signed-in one, passed in by the route from getCurrentActor - never an id
 * from the request body.
 */

type Actor = { userId: string; roles: readonly Role[] };

export const NOT_SAFETY_OFFICER_MESSAGE = 'Only a Safety Officer can run the operational safety check.';

/** AC7: refused before anything about an event is read. */
function assertSafetyOfficer(actor: Actor): void {
  if (!canRunSafetyCheck(actor.roles)) throw new ForbiddenError(NOT_SAFETY_OFFICER_MESSAGE);
}

async function readEvent(eventRequestId: string): Promise<EventRequestRow> {
  const id = z.string().uuid().safeParse(eventRequestId);
  if (!id.success) throw new NotFoundError('Event request');

  const { data, error } = await fetchEventRequestById(id.data);
  if (error) throw new ValidationError('The event request could not be read.', error.message);
  if (!data) throw new NotFoundError('Event request');
  return data as unknown as EventRequestRow;
}

const time = (value: string | null) => (value === null ? null : fromDatabaseTime(value));

// ---------------------------------------------------------------------------
// AC1 — the list
// ---------------------------------------------------------------------------

type QueueRow = {
  id: string;
  reference: string;
  name: string;
  proposed_date: string | null;
  start_time: string | null;
  end_time: string | null;
  expected_attendance: number | null;
  client_organisation: { name: string } | null;
  venue_booking: { status: string; venue: { name: string } | null }[];
};

/** AC1: the Confirmed events awaiting a safety check, earliest first. */
export async function listEventsAwaitingSafetyCheck(actor: Actor): Promise<SafetyCheckQueueItem[]> {
  assertSafetyOfficer(actor);

  const { data, error } = await fetchEventsAwaitingSafetyCheck();
  if (error) throw new ValidationError('The safety check list could not be read.', error.message);

  return (data as unknown as QueueRow[]).map((row) =>
    SafetyCheckQueueItemSchema.parse({
      id: row.id,
      reference: row.reference,
      name: row.name,
      clientOrganisation: row.client_organisation?.name ?? null,
      proposedDate: row.proposed_date,
      startTime: time(row.start_time),
      endTime: time(row.end_time),
      expectedAttendance: row.expected_attendance,
      venues: [
        ...new Set(
          row.venue_booking.filter((b) => b.status === 'confirmed').flatMap((b) => (b.venue ? [b.venue.name] : [])),
        ),
      ],
    }),
  );
}

// ---------------------------------------------------------------------------
// AC3-AC5 — the decisions on record
// ---------------------------------------------------------------------------

type CheckRow = { id: string; decision: string; note: string | null; decided_by: string; decided_at: string };

/** AC3: the decider's name, then their email, the same fallback as SCRUM-232's record. */
async function deciderNames(ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  const names = new Map<string, string>();
  if (unique.length === 0) return names;

  const { data } = await fetchProfileNames(unique);
  for (const row of data ?? []) if (row.full_name) names.set(row.id, row.full_name);
  for (const id of unique.filter((id) => !names.has(id))) {
    const { data: account } = await fetchAccountEmail(id);
    names.set(id, account?.user?.email ?? 'An unnamed account');
  }
  return names;
}

async function readChecks(eventRequestId: string): Promise<SafetyCheckRecord[]> {
  const { data, error } = await fetchSafetyChecks(eventRequestId);
  if (error) throw new ValidationError('The safety checks could not be read.', error.message);
  const rows = (data ?? []) as CheckRow[];
  const names = await deciderNames(rows.map((row) => row.decided_by));
  return rows.map((row) =>
    SafetyCheckRecordSchema.parse({
      id: row.id,
      decision: row.decision,
      note: row.note,
      decidedBy: row.decided_by,
      decidedByName: names.get(row.decided_by) ?? 'An unnamed account',
      decidedAt: row.decided_at,
    }),
  );
}

/**
 * AC4, AC5: the event's latest safety check, for its assigned coordinator's
 * event page, or null when it has none. Refused for anyone else.
 */
export async function getLatestSafetyCheck(eventRequestId: string, actor: Actor): Promise<SafetyCheckRecord | null> {
  const event = await readEvent(eventRequestId);
  if (!canViewSafetyOutcome(actor, event)) throw new ForbiddenError();
  return (await readChecks(event.id))[0] ?? null;
}

// ---------------------------------------------------------------------------
// AC2 — the check page
// ---------------------------------------------------------------------------

type BookingRow = {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  venue: { id: string; name: string; max_capacity: number; venue_layouts: { layout: string; capacity: number }[] } | null;
  request_line: {
    request: {
      id: string;
      expected_attendance: number | null;
      room_layout: string | null;
      accessibility_required: boolean | null;
      accessibility_notes: string | null;
    } | null;
  } | null;
};

const EMPTY_OWN = { expectedAttendance: null, roomLayout: null, accessibilityRequired: null, accessibilityNotes: null };

/**
 * AC2: one entry per venue and request the event is booked through. A booking
 * goes by its request's own venue requirements, and the event's for any it left
 * empty (SCRUM-230's venueRequirementsOf); a booking with no request goes by
 * the event's.
 */
function venuesOf(bookings: readonly BookingRow[], event: EventRequestRow): SafetyCheckVenue[] {
  const eventRequirements = {
    expectedAttendance: event.expected_attendance,
    roomLayout: event.room_layout,
    accessibilityRequired: event.accessibility_required,
    accessibilityNotes: event.accessibility_notes,
    accessibilityFeatures: event.event_request_accessibility_features.flatMap((link) =>
      link.accessibility_features ? [link.accessibility_features] : [],
    ),
  };

  const groups = new Map<string, SafetyCheckVenue>();
  for (const booking of bookings) {
    if (!booking.venue) continue;
    const request = booking.request_line?.request ?? null;
    const key = `${booking.venue.id}|${request?.id ?? 'event'}`;
    const slot = { date: booking.date, startTime: fromDatabaseTime(booking.start_time), endTime: fromDatabaseTime(booking.end_time) };

    const existing = groups.get(key);
    if (existing) {
      existing.bookings.push(slot);
      continue;
    }

    const own = request
      ? {
          expectedAttendance: request.expected_attendance,
          roomLayout: request.room_layout,
          accessibilityRequired: request.accessibility_required,
          accessibilityNotes: request.accessibility_notes,
        }
      : EMPTY_OWN;
    const inUse = venueRequirementsOf(own, eventRequirements);
    const layout = RoomLayoutSchema.safeParse(inUse.roomLayout.value);
    const layoutCapacity = layout.success
      ? (booking.venue.venue_layouts.find((l) => l.layout === layout.data)?.capacity ?? null)
      : null;

    groups.set(key, {
      venueId: booking.venue.id,
      venueName: booking.venue.name,
      maxCapacity: booking.venue.max_capacity,
      layout: { description: describeLayoutForVenueStaff(inUse.roomLayout.value), fromEvent: inUse.roomLayout.fromEvent },
      layoutCapacity,
      expectedAttendance: {
        description: describeAttendanceForVenueStaff(inUse.expectedAttendance.value),
        fromEvent: inUse.expectedAttendance.fromEvent,
      },
      accessibility: {
        description: describeAccessibilityForVenueStaff({
          accessibilityRequired: inUse.accessibility.required,
          accessibilityFeatures: inUse.accessibility.features,
          accessibilityNotes: inUse.accessibility.notes,
        }),
        fromEvent: inUse.accessibility.fromEvent,
      },
      bookings: [slot],
    });
  }
  return [...groups.values()];
}

type LineRow = { quantity: number; equipment: { name: string } | null };

/**
 * AC2: "the event's expected attendance, venue capacity and layout,
 * accessibility needs and requested equipment". Anything never recorded reads
 * "Not specified" (TC-234-06), the same words as Venue Staff's requirements
 * (SCRUM-143 AC4).
 *
 * Opened by the Safety Officer only (AC7). The event can be in any status, so
 * a decided check stays readable; whether a decision can be recorded is
 * awaitingCheck.
 */
export async function getSafetyCheckView(eventRequestId: string, actor: Actor): Promise<SafetyCheckView> {
  assertSafetyOfficer(actor);
  const event = await readEvent(eventRequestId);

  const [bookings, lines, request, checks] = await Promise.all([
    fetchConfirmedBookingsForSafetyCheck(event.id),
    fetchEquipmentRequestLines(event.id),
    fetchEquipmentRequest(event.id),
    readChecks(event.id),
  ]);
  if (bookings.error) throw new ValidationError('The venue bookings could not be read.', bookings.error.message);
  if (lines.error) throw new ValidationError('The equipment request could not be read.', lines.error.message);
  if (request.error) throw new ValidationError('The equipment request could not be read.', request.error.message);

  return SafetyCheckViewSchema.parse({
    eventRequestId: event.id,
    reference: event.reference,
    name: event.name,
    status: event.status,
    clientOrganisation: event.client_organisation?.name ?? null,
    proposedDate: event.proposed_date,
    startTime: time(event.start_time),
    endTime: time(event.end_time),
    expectedAttendance: describeAttendanceForVenueStaff(event.expected_attendance),
    roomLayout: describeLayoutForVenueStaff(event.room_layout),
    accessibility: describeAccessibilityForVenueStaff({
      accessibilityRequired: event.accessibility_required,
      accessibilityFeatures: event.event_request_accessibility_features.flatMap((link) =>
        link.accessibility_features ? [link.accessibility_features] : [],
      ),
      accessibilityNotes: event.accessibility_notes,
    }),
    venues: venuesOf((bookings.data ?? []) as unknown as BookingRow[], event),
    equipment: ((lines.data ?? []) as unknown as LineRow[]).map((line) => ({
      name: line.equipment?.name ?? NOT_SPECIFIED,
      quantity: line.quantity,
    })),
    technicalRequirements:
      (request.data as { technical_requirements: string | null } | null)?.technical_requirements ?? null,
    awaitingCheck: isAwaitingSafetyCheck(event.status),
    checks,
  });
}

// ---------------------------------------------------------------------------
// AC3-AC7 — recording a decision
// ---------------------------------------------------------------------------

/**
 * AC3: approve - the decision, the Safety Officer and the time are recorded
 * and the event moves to Preparation.
 * AC4: request changes with a note - the event returns to Planning.
 * AC5: reject with a reason - the event returns to Planning, not Cancelled.
 * AC7: refused for anyone without the Safety Officer role, before the event is
 * read. The decider is the signed-in account.
 *
 * The decision and the status move are one database call
 * (record_safety_check), so neither lands without the other.
 */
export async function recordSafetyCheckDecision(
  eventRequestId: string,
  input: unknown,
  actor: Actor,
): Promise<RecordSafetyCheckOutcome> {
  assertSafetyOfficer(actor);

  const parsed = RecordSafetyCheckInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'The decision is not valid.', parsed.error.flatten());
  }

  const event = await readEvent(eventRequestId);
  if (!isAwaitingSafetyCheck(event.status)) {
    throw new ConflictError(NOT_AWAITING_CHECK_MESSAGE, { status: event.status });
  }

  const { data, error } = await recordSafetyCheck({
    eventRequestId: event.id,
    decision: parsed.data.decision,
    note: parsed.data.note,
    decidedBy: actor.userId,
  });
  if (error) {
    // The schema refuses a blank or over-long note first; a check violation
    // means one got past it.
    if (isCheckViolation(error)) throw new ValidationError('The note is not valid.', error.message);
    throw new ValidationError('The safety check could not be recorded.', error.message);
  }
  // Read as Confirmed above, but another decision got there first.
  if (data !== 'recorded') {
    throw new ConflictError(NOT_AWAITING_CHECK_MESSAGE);
  }

  const [latest] = await readChecks(event.id);
  return RecordSafetyCheckOutcomeSchema.parse({ check: latest, status: STATUS_AFTER_DECISION[parsed.data.decision] });
}
