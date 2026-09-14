import {
  assignCoordinatorToEventRequest,
  fetchEventRequestById,
  listEventRequestsForCoordinator,
  type EventRequestRow,
} from '@/lib/supabase/eventRequests';
import { fetchProfileSummary } from '@/lib/supabase/profiles';
import {
  ConflictError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
} from '@/domain/shared/errors';
import { isRole, type Role } from '@/domain/identity/roles';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import { AssignCoordinatorInputSchema, EventRequestIdSchema } from './schema';
import { canBeAssigned, canReceiveAssignment } from './policy';

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
 * recorded with the manager who made it and the date.
 *
 * AC2 — no workload limit is applied: nothing here counts how many events the
 * chosen coordinator already holds (clarification #92).
 *
 * TODO(notifications): AC1 also says the assigned coordinator is notified.
 * There is no notification story in this sprint, so nothing is sent and the
 * limitation is documented rather than papered over with an email call. When
 * the Notification System story lands, this is the point to raise it from - the
 * assignment has just been recorded and the coordinator's id is to hand.
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

  return toAssignmentOutcome(data as unknown as EventRequestRow, target.full_name);
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
  assignedAt: string | null;
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
  }));
}
