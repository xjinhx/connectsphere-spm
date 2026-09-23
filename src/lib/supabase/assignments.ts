import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './admin';

/**
 * Coordinator reassignment and contact queries.
 *
 * SCRUM-96 Reassign an event to another coordinator
 * SCRUM-98 See who my coordinator is
 *
 * Kept apart from eventRequests.ts, which several stories already extend, so
 * this story adds a file instead of adding to a shared one. Same arrangement as
 * SCRUM-94's functions there: the client and the query both live here, and
 * domain/assignment/service.ts never holds a client (docs/architecture.md).
 */

function db(): SupabaseClient {
  return createAdminClient();
}

/** Just enough of an event to decide who may see or change its coordinator. */
export interface EventAssignmentRow {
  id: string;
  organiser_id: string;
  status: string;
  coordinator_id: string | null;
  assigned_by: string | null;
  assigned_at: string | null;
}

const ASSIGNMENT_COLUMNS = 'id, organiser_id, status, coordinator_id, assigned_by, assigned_at';

/** One replaced assignment (SCRUM-96 AC3). */
export interface CoordinatorHistoryRow {
  coordinator_id: string;
  assigned_by: string;
  assigned_at: string;
  replaced_at: string;
  replaced_by: string;
  replaced_by_coordinator_id: string;
}

/** The profile fields SCRUM-98 AC1 displays, plus roles to confirm a coordinator. */
export interface ContactProfileRow {
  id: string;
  full_name: string | null;
  contact_number: string | null;
  roles: unknown;
}

export async function fetchEventAssignment(eventRequestId: string) {
  return db()
    .from('event_request')
    .select(ASSIGNMENT_COLUMNS)
    .eq('id', eventRequestId)
    .maybeSingle();
}

/**
 * SCRUM-96 AC1 and AC2. Swaps the coordinator and records who made the change
 * in one statement; the record_coordinator_reassignment trigger copies the
 * replaced assignment into history and re-stamps assigned_at in that same
 * statement.
 *
 * The coordinator_id filter is the guard: the swap only happens if the event
 * is still held by the coordinator the manager saw. If someone else reassigned
 * it in between, no row matches and nothing changes, so two managers acting at
 * once cannot both win or overwrite each other silently. That holds only if
 * `fromCoordinatorId` is the one the manager's request named, not one read
 * again just before this call (SCRUM-215).
 */
export async function reassignEventCoordinator(
  eventRequestId: string,
  fromCoordinatorId: string,
  toCoordinatorId: string,
  reassignedBy: string,
) {
  return db()
    .from('event_request')
    .update({ coordinator_id: toCoordinatorId, assigned_by: reassignedBy })
    .eq('id', eventRequestId)
    .eq('coordinator_id', fromCoordinatorId)
    .select(ASSIGNMENT_COLUMNS)
    .maybeSingle();
}

const HISTORY_COLUMNS =
  'coordinator_id, assigned_by, assigned_at, replaced_at, replaced_by, replaced_by_coordinator_id';

/** An event's current assignment with every assignment it replaced (SCRUM-96 AC3). */
export interface EventAssignmentWithHistoryRow extends EventAssignmentRow {
  event_request_coordinator_history: CoordinatorHistoryRow[];
}

/**
 * SCRUM-96 AC3 and SCRUM-98: the event's current coordinator and its history,
 * oldest replacement first, in one request. PostgREST runs it as one
 * statement, so both come from the same moment. Read as two requests, a
 * reassignment committing between them showed the new coordinator's history
 * row beside the old coordinator (found reviewing SCRUM-215).
 */
export async function fetchEventAssignmentWithHistory(eventRequestId: string) {
  return db()
    .from('event_request')
    .select(`${ASSIGNMENT_COLUMNS}, event_request_coordinator_history ( ${HISTORY_COLUMNS} )`)
    .eq('id', eventRequestId)
    .order('replaced_at', { referencedTable: 'event_request_coordinator_history', ascending: true })
    .maybeSingle();
}

/** SCRUM-98 AC1: names and contact numbers for one or more accounts in one read. */
export async function fetchContactProfiles(accountIds: string[]) {
  return db()
    .from('profiles')
    .select('id, full_name, contact_number, roles')
    .in('id', accountIds);
}

/**
 * SCRUM-98 AC1: "ConnectSphere email address". That is the account's own
 * sign-in address, which lives in Supabase Auth rather than in profiles.
 */
export async function fetchAccountEmail(accountId: string) {
  return db().auth.admin.getUserById(accountId);
}
