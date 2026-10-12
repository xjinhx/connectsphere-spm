import {
  assignCoordinatorToEventRequest,
  fetchEventRequestById,
  listEventRequestsForCoordinator,
  listUnassignedSubmittedEventRequests,
  type EventRequestRow,
} from '@/lib/supabase/eventRequests';
import { fetchProfileSummary, listCoordinatorProfiles } from '@/lib/supabase/profiles';
import {
  fetchAccountEmail,
  fetchContactProfiles,
  fetchEventAssignment,
  fetchEventAssignmentWithHistory,
  reassignEventCoordinator,
  type ContactProfileRow,
  type CoordinatorHistoryRow,
  type EventAssignmentRow,
  type EventAssignmentWithHistoryRow,
} from '@/lib/supabase/assignments';
import { notifyBestEffort } from '@/domain/notification/service';
import {
  ConflictError,
  ForbiddenError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
} from '@/domain/shared/errors';
import { isRole, type Role } from '@/domain/identity/roles';
import { fromDatabaseTime } from '@/domain/shared/times';
import { EventRequestStatusEnum, type EventRequestStatus } from '@/domain/event-request/schema';
import {
  AssignCoordinatorInputSchema,
  EventRequestIdSchema,
  ReassignCoordinatorInputSchema,
} from './schema';
import {
  canBeAssigned,
  canBeReassigned,
  canReceiveAssignment,
  canViewCoordinatorDetails,
  isCurrentCoordinator,
} from './policy';

/**
 * SCRUM-94 — Assign an Event Coordinator to a submitted event.
 *
 * Orchestration only: validates the input, applies the rules from policy.ts,
 * and calls functions in src/lib/supabase/. Per docs/architecture.md (rule 3)
 * it never imports a Supabase client or builds a query itself.
 *
 * Who may assign is AC4 and lives in the route, through SCRUM-69's permission
 * matrix - the same pattern as the approve route (SCRUM-92) and the account
 * roles route (SCRUM-206).
 */

// ---------------------------------------------------------------------------
// AC1 — assign
// ---------------------------------------------------------------------------

/** What AC1 records: who owns the event, who said so, and when. */
export interface AssignmentOutcome {
  id: string;
  coordinatorId: string;
  /** For display. Null when the profile has no name recorded yet. */
  coordinatorName: string | null;
  assignedBy: string;
  /** An instant, stamped by the database (see the set_assigned_at trigger). */
  assignedAt: string;
}

interface ProfileSummary {
  id: string;
  full_name: string | null;
  roles: Role[];
}

async function readProfile(accountId: string): Promise<ProfileSummary | null> {
  const { data, error } = await fetchProfileSummary(accountId);
  if (error) throw new ValidationError('The account could not be read.', error.message);
  if (!data) return null;

  const row = data as { id: string; full_name: string | null; roles: unknown };
  return {
    id: row.id,
    full_name: row.full_name,
    // profiles.roles is a text[] with a check constraint, but the generated
    // type is plain string[]; filtering through isRole keeps this honest
    // without a cast that would hide a value the app does not know.
    roles: ((row.roles as unknown[] | null) ?? []).filter(isRole),
  };
}

/**
 * AC5 — the second manager is told the event is already assigned, and to whom.
 * The name is read separately because the row only carries the coordinator's
 * id; a join would return it in one trip, but this path runs only when two
 * managers collide, which is rare enough not to optimise for.
 */
async function alreadyAssignedError(coordinatorId: string): Promise<ConflictError> {
  const holder = await readProfile(coordinatorId);
  const name = holder?.full_name ?? 'another coordinator';
  return new ConflictError(`This event is already assigned to ${name}.`, {
    coordinatorId,
    coordinatorName: holder?.full_name ?? null,
  });
}

function toAssignmentOutcome(row: EventRequestRow, coordinatorName: string | null): AssignmentOutcome {
  // event_request_assignment_complete guarantees the three are written
  // together, so this cannot happen for a row that was just assigned. Checked
  // rather than asserted, because the alternative is a non-null assertion that
  // would hide a real inconsistency if one ever occurred.
  if (row.coordinator_id === null || row.assigned_by === null || row.assigned_at === null) {
    throw new ValidationError('The assignment was recorded incompletely.');
  }

  return {
    id: row.id,
    coordinatorId: row.coordinator_id,
    coordinatorName,
    assignedBy: row.assigned_by,
    assignedAt: row.assigned_at,
  };
}

/**
 * AC1 — a submitted event with no coordinator gets one, and the assignment is
 * recorded with the manager who made it and the date. AC1 also says the
 * assigned coordinator is notified - see the notifyBestEffort call below
 * (formerly dummy D-03, now replaced; docs/dummies.md).
 *
 * AC2 — no workload limit is applied: nothing here counts how many events the
 * chosen coordinator already holds (clarification #92).
 */
export async function assignCoordinator(
  eventRequestId: string,
  input: unknown,
): Promise<AssignmentOutcome> {
  const parsedId = EventRequestIdSchema.safeParse(eventRequestId);
  if (!parsedId.success) throw new NotFoundError('Event request');

  const parsedInput = AssignCoordinatorInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new ValidationError('The assignment is not valid.', parsedInput.error.flatten());
  }
  const { coordinatorId, actorId } = parsedInput.data;

  const { data: existing, error: readError } = await fetchEventRequestById(parsedId.data);
  if (readError) {
    throw new ValidationError('The event request could not be read.', readError.message);
  }
  if (!existing) throw new NotFoundError('Event request');
  const current = existing as unknown as EventRequestRow;

  // The person being assigned has to exist and has to be a coordinator. A bad
  // choice is the caller's mistake, not a missing event, so it is a 400 naming
  // the problem rather than a 404 about the event.
  const target = await readProfile(coordinatorId);
  if (!target) throw new ValidationError('The chosen account does not exist.');
  if (!canReceiveAssignment(target.roles)) {
    throw new ValidationError('The chosen account is not an Event Coordinator.');
  }

  if (!canBeAssigned(current.status, current.coordinator_id)) {
    // Two different refusals wearing one hat would be unhelpful: say whether
    // the event is the wrong kind, or already owned (AC5).
    if (current.coordinator_id !== null) throw await alreadyAssignedError(current.coordinator_id);
    throw new InvalidTransitionError(current.status, 'assigned');
  }

  const { data, error } = await assignCoordinatorToEventRequest(parsedId.data, coordinatorId, actorId);
  if (error) {
    throw new ValidationError('The coordinator could not be assigned.', error.message);
  }
  // The check above saw an unassigned submitted event, yet no row matched the
  // filters: another manager assigned it in between (AC5). The filters are what
  // make that safe; this turns it into an answer for whoever came second,
  // naming the coordinator who now holds it.
  if (!data) {
    const { data: latest } = await fetchEventRequestById(parsedId.data);
    const row = latest as unknown as EventRequestRow | null;
    if (row?.coordinator_id) throw await alreadyAssignedError(row.coordinator_id);
    throw new ConflictError('This event could not be assigned; its state has changed.');
  }

  const assignedRow = data as unknown as EventRequestRow;
  // Notifies the newly assigned coordinator - replaces dummy D-03, now
  // Replaced (docs/dummies.md). Best-effort: the assignment above already
  // succeeded, so a notification failure must not undo it.
  await notifyBestEffort({
    recipientId: coordinatorId,
    type: 'coordinator_assigned',
    eventRequestId: assignedRow.id,
    message: `You have been assigned to ${assignedRow.reference} (${assignedRow.name}).`,
  });

  // SCRUM-198 AC5: the organiser is also told who their coordinator is.
  // Confirmed with the PO this is a second notification alongside the
  // coordinator's own, not a replacement for it.
  await notifyBestEffort({
    recipientId: assignedRow.organiser_id,
    type: 'coordinator_named',
    eventRequestId: assignedRow.id,
    message: `${target.full_name ?? 'A coordinator'} is now the coordinator for ${assignedRow.reference} (${assignedRow.name}).`,
  });

  return toAssignmentOutcome(assignedRow, target.full_name);
}

// ---------------------------------------------------------------------------
// AC3 — the coordinator's own events
// ---------------------------------------------------------------------------

/**
 * One row of "the events assigned to me". Deliberately smaller than
 * event-request's EventRequest: this answers "what do I own", not "tell me
 * everything about this request", which is SCRUM-89's read.
 */
export interface AssignedEvent {
  id: string;
  reference: string;
  name: string;
  status: EventRequestStatus;
  proposedDate: string | null;
  submittedAt: string | null;
  /** SCRUM-238. `HH:MM` Singapore time; null until the organiser gives them. */
  startTime: string | null;
  endTime: string | null;
  assignedAt: string | null;
  /** Null until the organiser has been linked to a client organisation. */
  clientOrganisation: { id: string; name: string } | null;
}

/**
 * AC3 — the events the signed-in coordinator has been assigned, so they appear
 * in their queue when they next log in.
 *
 * No accept or decline is offered, and none is built: clarification #95 says
 * there is no acceptance step, so an assignment is simply true once made. That
 * half of AC3 is met by this being a read and nothing else.
 *
 * Who may read: only your own assignments, because the coordinator id comes
 * from the session rather than the URL. No role check is needed - a signed-in
 * non-coordinator owns no events, so they get an empty list.
 *
 * The queue *page* is SCRUM-88 (Review submitted requests from the queue). This
 * is the data behind it, not that story's UI.
 */
export async function listMyAssignedEvents(coordinatorId: string): Promise<AssignedEvent[]> {
  const { data, error } = await listEventRequestsForCoordinator(coordinatorId);
  if (error) {
    throw new ValidationError('The assigned events could not be read.', error.message);
  }

  const rows = (data ?? []) as unknown as EventRequestRow[];
  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    name: row.name,
    status: row.status,
    proposedDate: row.proposed_date,
    assignedAt: row.assigned_at,
    submittedAt: row.submitted_at,
    startTime: row.start_time === null ? null : fromDatabaseTime(row.start_time),
    endTime: row.end_time === null ? null : fromDatabaseTime(row.end_time),
    clientOrganisation: row.client_organisation,
  }));
}

// ---------------------------------------------------------------------------
// SCRUM-95 — See submitted events with no coordinator
// ---------------------------------------------------------------------------

/**
 * One row of "submitted, needs a coordinator". Same shape as AssignedEvent
 * (SCRUM-88's queue), minus the assignment fields this list is specifically
 * about the absence of.
 */
export interface UnassignedEvent {
  id: string;
  reference: string;
  name: string;
  proposedDate: string | null;
  submittedAt: string | null;
}

/**
 * AC1 — every submitted event with no coordinator, oldest submission first.
 * This is the pool an Operations Manager still needs to work through, not
 * "everything submitted" (listSubmittedEventRequests already answers that,
 * without the coordinator filter, and is used elsewhere).
 *
 * Who may read: checked in the page through SCRUM-69's permission matrix
 * (coordinator_assignment), same as the assign action itself - seeing the
 * queue and acting on it are gated by the same permission.
 */
export async function listUnassignedEvents(): Promise<UnassignedEvent[]> {
  const { data, error } = await listUnassignedSubmittedEventRequests();
  if (error) {
    throw new ValidationError('The unassigned events could not be read.', error.message);
  }

  const rows = (data ?? []) as unknown as EventRequestRow[];
  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    name: row.name,
    proposedDate: row.proposed_date,
    submittedAt: row.submitted_at,
  }));
}

// ---------------------------------------------------------------------------
// Who an event can be assigned to
// ---------------------------------------------------------------------------

/** One choice in the picker an Operations Manager assigns from. */
export interface AssignableCoordinator {
  id: string;
  /** Null when the profile has no name recorded yet — shown as the id's stand-in. */
  name: string | null;
}

/**
 * The coordinators an event may be assigned to.
 *
 * The same rule the write applies, asked in advance: assignCoordinator refuses
 * an account that is not an Event Coordinator (canReceiveAssignment), and this
 * is the list of accounts that would pass it. Filtered through canReceiveAssignment
 * rather than trusting the query, so the list and the refusal cannot disagree
 * about who is eligible.
 *
 * No workload count is returned with each name. AC2 applies no limit
 * (clarification #92), so a count here would suggest a cap that does not exist.
 */
export async function listAssignableCoordinators(): Promise<AssignableCoordinator[]> {
  const { data, error } = await listCoordinatorProfiles();
  if (error) {
    throw new ValidationError('The coordinators could not be read.', error.message);
  }

  const rows = (data ?? []) as { id: string; full_name: string | null; roles: unknown }[];
  return rows
    .filter((row) => canReceiveAssignment(((row.roles as unknown[] | null) ?? []).filter(isRole)))
    .map((row) => ({ id: row.id, name: row.full_name }));
}

// ---------------------------------------------------------------------------
// SCRUM-96 — Reassign an event to another coordinator
// SCRUM-98 — See who my coordinator is
// ---------------------------------------------------------------------------

/** What a reassignment leaves behind (SCRUM-96 AC1). */
export interface ReassignmentOutcome {
  id: string;
  previousCoordinatorId: string;
  coordinatorId: string;
  /** For display. Null when the profile has no name recorded yet. */
  coordinatorName: string | null;
  assignedBy: string;
  /** Re-stamped by the database when the coordinator changes. */
  assignedAt: string;
}

/** SCRUM-98 AC1 — the details an organiser sees for their coordinator. */
export interface CoordinatorContact {
  id: string;
  fullName: string | null;
  /** The account's ConnectSphere sign-in address. */
  email: string | null;
  /** Null until recorded; entering it is SCRUM-205. */
  contactNumber: string | null;
}

/** SCRUM-96 AC3 — one assignment that has since been replaced. */
export interface AssignmentHistoryEntry {
  coordinatorId: string;
  coordinatorName: string | null;
  assignedAt: string;
  replacedAt: string;
  replacedByCoordinatorId: string;
  replacedByCoordinatorName: string | null;
}

/** SCRUM-96 AC3 and SCRUM-98 AC1 to AC3 — an event's coordinator, now and before. */
export interface CoordinatorView {
  eventRequestId: string;
  /** Null means a coordinator has not yet been assigned (SCRUM-98 AC2). */
  current: CoordinatorContact | null;
  assignedAt: string | null;
  /** Oldest first. Empty until the event has been reassigned at least once. */
  history: AssignmentHistoryEntry[];
}

async function readEventAssignment(eventRequestId: string): Promise<EventAssignmentRow> {
  const parsedId = EventRequestIdSchema.safeParse(eventRequestId);
  if (!parsedId.success) throw new NotFoundError('Event request');

  const { data, error } = await fetchEventAssignment(parsedId.data);
  if (error) throw new ValidationError('The event request could not be read.', error.message);
  if (!data) throw new NotFoundError('Event request');
  return data as unknown as EventAssignmentRow;
}

/**
 * SCRUM-215 — the answer for a manager whose reassignment lost to someone
 * else's. Names who holds the event now, the way alreadyAssignedError does for
 * SCRUM-94 AC5, so they can decide whether to try again from the current state.
 */
async function reassignedMeanwhileError(coordinatorId: string | null): Promise<ConflictError> {
  const holder = coordinatorId ? await readProfile(coordinatorId) : null;
  const name = holder?.full_name ?? 'another coordinator';
  return new ConflictError(
    `This event has been reassigned to ${name} since you loaded it. Reload and try again.`,
    { coordinatorId, coordinatorName: holder?.full_name ?? null },
  );
}

/**
 * SCRUM-96 AC1 — the new coordinator replaces the previous one.
 * SCRUM-96 AC2 — effective immediately, with no approval or acceptance step.
 *
 * AC2 needs nothing extra: the swap is a single update of the event's current
 * coordinator, which is what SCRUM-94's queue reads, and no pending state
 * exists to create. The previous assignment is copied to history by the
 * record_coordinator_reassignment trigger inside that same update (AC3).
 *
 * Who may reassign is checked in the route through SCRUM-69's permission
 * matrix (`coordinator_assignment`), the same as SCRUM-94's assign.
 *
 * DUMMY(SCRUM-24) D-06: AC1 also says both coordinators are notified. The
 * Notification System (SCRUM-24) is not in this sprint, so nothing is sent:
 * the recorded reassignment is the minimum honest implementation, and
 * event_request_coordinator_history holds exactly what a notification to
 * either coordinator would need (who, from whom, to whom, when). When
 * SCRUM-24 lands, raise both notifications from here, where
 * previousCoordinatorId and coordinatorId are both to hand. See
 * docs/dummies.md.
 *
 * SCRUM-215: two managers reassigning at once. Each says which coordinator
 * they are moving the event away from (`fromCoordinatorId`, the one they saw),
 * and the update only goes ahead while the event is still held by that
 * coordinator. Whoever acts second is refused, whether their request overlaps
 * the first or arrives after it, rather than silently replacing a
 * reassignment they never saw.
 */
export async function reassignCoordinator(
  eventRequestId: string,
  input: unknown,
): Promise<ReassignmentOutcome> {
  const current = await readEventAssignment(eventRequestId);

  const parsedInput = ReassignCoordinatorInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new ValidationError('The reassignment is not valid.', parsedInput.error.flatten());
  }
  const { coordinatorId, actorId, fromCoordinatorId } = parsedInput.data;

  // Same target rule as SCRUM-94: the new owner has to be an Event Coordinator.
  const target = await readProfile(coordinatorId);
  if (!target) throw new ValidationError('The chosen account does not exist.');
  if (!canReceiveAssignment(target.roles)) {
    throw new ValidationError('The chosen account is not an Event Coordinator.');
  }

  // The two halves of canBeReassigned fail differently, so they are told apart:
  // nothing to reassign is a state problem, the same person is a bad choice.
  const previousCoordinatorId = current.coordinator_id;
  if (previousCoordinatorId === null) {
    // Point the manager at assigning only when SCRUM-94 would accept it. An
    // event approved before anyone was assigned cannot be assigned, so "assign
    // one instead" sent them to an action that refuses (found reviewing
    // SCRUM-215; whether such an event should be assignable is for the team).
    const status = EventRequestStatusEnum.safeParse(current.status);
    throw new ConflictError(
      status.success && canBeAssigned(status.data, null)
        ? 'This event has no coordinator yet. Assign one instead of reassigning.'
        : 'This event has no coordinator to reassign from, and only a submitted event can be assigned one.',
    );
  }
  // The manager chose from a view that is out of date: someone else has
  // reassigned the event since. Refused before anything is written.
  if (previousCoordinatorId !== fromCoordinatorId) {
    throw await reassignedMeanwhileError(previousCoordinatorId);
  }
  if (!canBeReassigned(previousCoordinatorId, coordinatorId)) {
    throw new ValidationError('This event is already assigned to that coordinator.');
  }

  const { data, error } = await reassignEventCoordinator(
    current.id,
    fromCoordinatorId,
    coordinatorId,
    actorId,
  );
  if (error) {
    throw new ValidationError('The coordinator could not be reassigned.', error.message);
  }
  // The guard matched no row: someone reassigned the event between our read
  // and this update. Nothing was written, so say so rather than overwrite them.
  if (!data) {
    const latest = await readEventAssignment(current.id);
    throw await reassignedMeanwhileError(latest.coordinator_id);
  }

  const row = data as unknown as EventAssignmentRow;
  if (row.coordinator_id === null || row.assigned_by === null || row.assigned_at === null) {
    throw new ValidationError('The reassignment was recorded incompletely.');
  }

  return {
    id: row.id,
    previousCoordinatorId,
    coordinatorId: row.coordinator_id,
    coordinatorName: target.full_name,
    assignedBy: row.assigned_by,
    assignedAt: row.assigned_at,
  };
}

/**
 * SCRUM-96 AC4 — throws unless the caller is the event's current coordinator,
 * so a coordinator reassigned away is denied before anything is returned.
 *
 * No route calls this. Where AC4 is enforced: getCoordinatorView below (GET
 * /coordinator), and SCRUM-89's review read and SCRUM-213's approve through
 * canReviewDetail. Those deliberately use canReviewDetail instead of this,
 * because review access also allows an event with no coordinator yet, which
 * this refuses (see review/service.ts). Use this only for a read that must
 * refuse unassigned events too, and never as the only gate before a write:
 * put the coordinator in the UPDATE's filter, as SCRUM-213 does.
 */
export async function requireCurrentCoordinator(eventRequestId: string, actorUserId: string): Promise<void> {
  const event = await readEventAssignment(eventRequestId);
  if (!isCurrentCoordinator(event.coordinator_id, actorUserId)) {
    throw new ForbiddenError('This event is not assigned to you.');
  }
}

async function readContactProfiles(accountIds: string[]): Promise<Map<string, ContactProfileRow>> {
  const unique = [...new Set(accountIds)];
  if (unique.length === 0) return new Map();

  const { data, error } = await fetchContactProfiles(unique);
  if (error) throw new ValidationError('The coordinator details could not be read.', error.message);
  const rows = (data ?? []) as unknown as ContactProfileRow[];
  return new Map(rows.map((row) => [row.id, row]));
}

async function readAccountEmail(accountId: string): Promise<string | null> {
  const { data, error } = await fetchAccountEmail(accountId);
  if (error) throw new ValidationError('The coordinator email could not be read.', error.message);
  return data.user?.email ?? null;
}

/**
 * SCRUM-96 AC3 — "the current coordinator is shown and the previous assignment
 * remains in the event's history".
 * SCRUM-98 AC1 — the coordinator's full name, email and contact number.
 * SCRUM-98 AC2 — `current` is null when no coordinator has been assigned.
 * SCRUM-98 AC3 — after a reassignment, `current` is the new coordinator,
 * because it is read from the event's current owner every time.
 *
 * Access is decided before any coordinator's details are read or anything is
 * returned: the organiser who owns the event, its current coordinator, or an
 * Event Operations Manager. A coordinator reassigned away is refused
 * (SCRUM-96 AC4).
 *
 * The coordinator and the history are read together, so they always agree
 * (found reviewing SCRUM-215; see fetchEventAssignmentWithHistory).
 */
export async function getCoordinatorView(
  eventRequestId: string,
  actor: { userId: string; roles: readonly Role[] },
): Promise<CoordinatorView> {
  const parsedId = EventRequestIdSchema.safeParse(eventRequestId);
  if (!parsedId.success) throw new NotFoundError('Event request');

  const { data, error } = await fetchEventAssignmentWithHistory(parsedId.data);
  if (error) throw new ValidationError('The event request could not be read.', error.message);
  if (!data) throw new NotFoundError('Event request');
  const event = data as unknown as EventAssignmentWithHistoryRow;

  if (
    !canViewCoordinatorDetails(
      { organiserId: event.organiser_id, coordinatorId: event.coordinator_id },
      actor,
    )
  ) {
    throw new ForbiddenError('You do not have access to this event.');
  }

  const historyRows: CoordinatorHistoryRow[] = event.event_request_coordinator_history ?? [];

  const people = await readContactProfiles([
    ...(event.coordinator_id ? [event.coordinator_id] : []),
    ...historyRows.flatMap((row) => [row.coordinator_id, row.replaced_by_coordinator_id]),
  ]);
  const nameOf = (id: string) => people.get(id)?.full_name ?? null;

  let current: CoordinatorContact | null = null;
  if (event.coordinator_id) {
    const profile = people.get(event.coordinator_id);
    current = {
      id: event.coordinator_id,
      fullName: profile?.full_name ?? null,
      email: await readAccountEmail(event.coordinator_id),
      contactNumber: profile?.contact_number ?? null,
    };
  }

  return {
    eventRequestId: event.id,
    current,
    assignedAt: event.assigned_at,
    history: historyRows.map((row) => ({
      coordinatorId: row.coordinator_id,
      coordinatorName: nameOf(row.coordinator_id),
      assignedAt: row.assigned_at,
      replacedAt: row.replaced_at,
      replacedByCoordinatorId: row.replaced_by_coordinator_id,
      replacedByCoordinatorName: nameOf(row.replaced_by_coordinator_id),
    })),
  };
}
