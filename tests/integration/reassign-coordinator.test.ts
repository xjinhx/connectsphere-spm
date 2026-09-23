import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  assignCoordinator,
  getCoordinatorView,
  listMyAssignedEvents,
  reassignCoordinator,
  requireCurrentCoordinator,
} from '@/domain/assignment/service';
import type { Role } from '@/domain/identity/roles';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-96 Reassign an event to another coordinator
 * SCRUM-98 See who my coordinator is
 *
 * AC text is from the Jira cards, which are authoritative.
 *
 * Runs against the local Supabase stack, the same as CI's "Migrations and
 * integration tests" job. A real database is the point: the assignment history
 * is written by a trigger inside the reassignment update, and the guard against
 * two managers reassigning at once lives in that update's filter. Neither can
 * be proved without Postgres.
 *
 * The admin client arranges rows here; that is test setup, not the code under
 * test, which never holds a client (docs/architecture.md).
 *
 * Not covered here, verify manually or later:
 *   SCRUM-96 AC1 "both are notified": no notification story this sprint, so
 *        nothing is sent. Flag for re-execution once the Notification System
 *        exists.
 *   SCRUM-96 AC4 through SCRUM-89's review read: that read is not on main yet.
 *        requireCurrentCoordinator is the rule it should call, tested below.
 *   The HTTP routes: the middleware needs a signed-in session, so those are
 *        covered by the manual test.
 */

const supabase = createAdminClient();
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

/** `userId` duplicates `id` so an account can be passed straight in as the actor. */
interface Account {
  id: string;
  userId: string;
  roles: Role[];
}

let organiser: Account;
let otherOrganiser: Account;
let manager: Account;
let otherManager: Account;
let coordinatorA: Account;
let coordinatorB: Account;
let coordinatorC: Account;
let attendee: Account;
const createdRequestIds: string[] = [];

async function createAccount(
  label: string,
  roles: Role[],
  contactNumber: string | null = null,
): Promise<Account> {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const email = `${slug}+${Date.now()}${Math.random().toString(36).slice(2, 8)}@connectsphere.example.com`;
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`could not create test ${label}: ${error?.message ?? 'no user returned'}`);
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ roles, full_name: label, contact_number: contactNumber })
    .eq('id', data.user.id);
  if (profileError) throw new Error(`could not set up profile for ${label}: ${profileError.message}`);

  return { id: data.user.id, userId: data.user.id, roles };
}

async function emailOf(accountId: string): Promise<string | undefined> {
  const { data } = await supabase.auth.admin.getUserById(accountId);
  return data.user?.email;
}

/** A submitted request owned by `organiser`, optionally assigned to a coordinator. */
async function createSubmittedRequest(assignTo?: Account): Promise<string> {
  const { data, error } = await supabase
    .from('event_request')
    .insert({
      organiser_id: organiser.id,
      client_organisation_id: CLIENT_ORGANISATION_ID,
      name: 'Annual Tech Summit',
    })
    .select('id')
    .single();
  if (error) throw new Error(`could not create test request: ${error.message}`);

  const id = data.id as string;
  createdRequestIds.push(id);

  const { error: submitError } = await supabase
    .from('event_request')
    .update({ status: 'submitted' })
    .eq('id', id);
  if (submitError) throw new Error(`could not submit test request: ${submitError.message}`);

  if (assignTo) {
    await assignCoordinator(id, { coordinatorId: assignTo.id, actorId: manager.id });
  }
  return id;
}

async function readRow(id: string) {
  const { data, error } = await supabase
    .from('event_request')
    .select('status, coordinator_id, assigned_by, assigned_at')
    .eq('id', id)
    .single();
  if (error) throw new Error(`could not read test request: ${error.message}`);
  return data;
}

async function readHistory(id: string) {
  const { data, error } = await supabase
    .from('event_request_coordinator_history')
    .select('coordinator_id, assigned_by, assigned_at, replaced_at, replaced_by, replaced_by_coordinator_id')
    .eq('event_request_id', id)
    .order('replaced_at', { ascending: true });
  if (error) throw new Error(`could not read history: ${error.message}`);
  return data ?? [];
}

beforeAll(async () => {
  // SCRUM-203's FK on client_organisation_id means CLIENT_ORGANISATION_ID
  // below must be a real row, not just a placeholder uuid.
  await ensureTestClientOrganisation(supabase);

  organiser = await createAccount('Olivia Organiser', ['event_organiser']);
  otherOrganiser = await createAccount('Oscar Organiser', ['event_organiser']);
  manager = await createAccount('Mia Manager', ['operations_manager']);
  otherManager = await createAccount('Max Manager', ['operations_manager']);
  coordinatorA = await createAccount('Jane Tan', ['coordinator'], '+65 6123 4567');
  coordinatorB = await createAccount('Wei Lin', ['coordinator'], '+65 6765 4321');
  coordinatorC = await createAccount('Sam Lee', ['coordinator']);
  attendee = await createAccount('Andy Attendee', ['attendee']);
});

afterAll(async () => {
  // Requests first: history cascades with them, and every account reference is
  // ON DELETE RESTRICT, so accounts can only go once nothing points at them.
  for (const id of createdRequestIds) {
    await supabase.from('event_request').delete().eq('id', id);
  }
  for (const account of [
    organiser,
    otherOrganiser,
    manager,
    otherManager,
    coordinatorA,
    coordinatorB,
    coordinatorC,
    attendee,
  ]) {
    if (account) await supabase.auth.admin.deleteUser(account.id);
  }
});

describe('reassignCoordinator: SCRUM-96 AC1 and AC2', () => {
  // SCRUM-96 AC1, US-8.1-TC03
  it('US-8.1-TC03 replaces the previous coordinator with the new one', async () => {
    const id = await createSubmittedRequest(coordinatorA);

    const outcome = await reassignCoordinator(id, { coordinatorId: coordinatorB.id, actorId: otherManager.id });

    expect(outcome.previousCoordinatorId).toBe(coordinatorA.id);
    expect(outcome.coordinatorId).toBe(coordinatorB.id);
    expect(outcome.coordinatorName).toBe('Wei Lin');
    expect(outcome.assignedBy).toBe(otherManager.id);

    const row = await readRow(id);
    expect(row.coordinator_id).toBe(coordinatorB.id);
    expect(row.assigned_by).toBe(otherManager.id);
  });

  // SCRUM-96 AC2: effective immediately, US-8.1-TC03's queues
  it('moves the event out of the old queue and into the new one at once', async () => {
    const id = await createSubmittedRequest(coordinatorA);

    await reassignCoordinator(id, { coordinatorId: coordinatorB.id, actorId: manager.id });

    expect((await listMyAssignedEvents(coordinatorB.id)).map((e) => e.id)).toContain(id);
    expect((await listMyAssignedEvents(coordinatorA.id)).map((e) => e.id)).not.toContain(id);
  });

  // SCRUM-96 AC2: no approval or acceptance step
  it('creates no pending state: the event status is untouched', async () => {
    const id = await createSubmittedRequest(coordinatorA);

    await reassignCoordinator(id, { coordinatorId: coordinatorB.id, actorId: manager.id });

    expect((await readRow(id)).status).toBe('submitted');
  });

  it('re-stamps the assignment date from the database clock', async () => {
    const id = await createSubmittedRequest(coordinatorA);
    const firstAssignedAt = new Date((await readRow(id)).assigned_at as string).getTime();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const outcome = await reassignCoordinator(id, { coordinatorId: coordinatorB.id, actorId: manager.id });

    expect(new Date(outcome.assignedAt).getTime()).toBeGreaterThan(firstAssignedAt);
  });

  it('refuses an event that has no coordinator, and records no history', async () => {
    const id = await createSubmittedRequest();

    await expect(
      reassignCoordinator(id, { coordinatorId: coordinatorB.id, actorId: manager.id }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect((await readRow(id)).coordinator_id).toBeNull();
    expect(await readHistory(id)).toHaveLength(0);
  });

  it('refuses reassigning to the coordinator who already holds it', async () => {
    const id = await createSubmittedRequest(coordinatorA);

    await expect(
      reassignCoordinator(id, { coordinatorId: coordinatorA.id, actorId: manager.id }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(await readHistory(id)).toHaveLength(0);
  });

  it('refuses an account that is not an Event Coordinator', async () => {
    const id = await createSubmittedRequest(coordinatorA);

    await expect(
      reassignCoordinator(id, { coordinatorId: attendee.id, actorId: manager.id }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect((await readRow(id)).coordinator_id).toBe(coordinatorA.id);
  });

  it('reports an unknown or malformed event as not found', async () => {
    await expect(
      reassignCoordinator('00000000-0000-0000-0000-000000000000', {
        coordinatorId: coordinatorB.id,
        actorId: manager.id,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      reassignCoordinator('not-a-uuid', { coordinatorId: coordinatorB.id, actorId: manager.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('records exactly one reassignment when two managers reassign at once', async () => {
    const id = await createSubmittedRequest(coordinatorA);

    const results = await Promise.allSettled([
      reassignCoordinator(id, { coordinatorId: coordinatorB.id, actorId: manager.id }),
      reassignCoordinator(id, { coordinatorId: coordinatorC.id, actorId: otherManager.id }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'CONFLICT' });

    const history = await readHistory(id);
    expect(history).toHaveLength(1);
    expect(history[0]?.coordinator_id).toBe(coordinatorA.id);
    expect([coordinatorB.id, coordinatorC.id]).toContain((await readRow(id)).coordinator_id);
  });
});

describe('assignment history: SCRUM-96 AC3', () => {
  it('keeps the previous assignment, who replaced it, with whom and when', async () => {
    const id = await createSubmittedRequest(coordinatorA);
    const original = await readRow(id);

    await reassignCoordinator(id, { coordinatorId: coordinatorB.id, actorId: otherManager.id });

    const history = await readHistory(id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      coordinator_id: coordinatorA.id,
      assigned_by: manager.id,
      replaced_by: otherManager.id,
      replaced_by_coordinator_id: coordinatorB.id,
    });
    expect(new Date(history[0]?.assigned_at as string).getTime()).toBe(
      new Date(original.assigned_at as string).getTime(),
    );
  });

  it('keeps every earlier assignment across repeated reassignments, oldest first', async () => {
    const id = await createSubmittedRequest(coordinatorA);

    await reassignCoordinator(id, { coordinatorId: coordinatorB.id, actorId: manager.id });
    await reassignCoordinator(id, { coordinatorId: coordinatorC.id, actorId: manager.id });

    const view = await getCoordinatorView(id, manager);
    expect(view.current?.id).toBe(coordinatorC.id);
    expect(view.history.map((entry) => entry.coordinatorName)).toEqual(['Jane Tan', 'Wei Lin']);
    expect(view.history.map((entry) => entry.replacedByCoordinatorName)).toEqual(['Wei Lin', 'Sam Lee']);
  });

  it('writes no history for the first assignment, which replaces nobody', async () => {
    const id = await createSubmittedRequest(coordinatorA);
    expect(await readHistory(id)).toHaveLength(0);
  });
});

describe('access for a coordinator reassigned away: SCRUM-96 AC4', () => {
  it('denies the previous coordinator and returns no details', async () => {
    const id = await createSubmittedRequest(coordinatorA);
    await reassignCoordinator(id, { coordinatorId: coordinatorB.id, actorId: manager.id });

    await expect(requireCurrentCoordinator(id, coordinatorA.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(getCoordinatorView(id, coordinatorA)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows the coordinator who now holds the event', async () => {
    const id = await createSubmittedRequest(coordinatorA);
    await reassignCoordinator(id, { coordinatorId: coordinatorB.id, actorId: manager.id });

    await expect(requireCurrentCoordinator(id, coordinatorB.id)).resolves.toBeUndefined();
    expect((await getCoordinatorView(id, coordinatorB)).current?.id).toBe(coordinatorB.id);
  });
});

describe('getCoordinatorView: SCRUM-98', () => {
  // SCRUM-98 AC1, US-8.2-TC03
  it("US-8.2-TC03 shows the organiser the coordinator's full name, email and contact number", async () => {
    const id = await createSubmittedRequest(coordinatorA);

    const view = await getCoordinatorView(id, organiser);

    expect(view.current).toEqual({
      id: coordinatorA.id,
      fullName: 'Jane Tan',
      email: await emailOf(coordinatorA.id),
      contactNumber: '+65 6123 4567',
    });
    expect(view.assignedAt).toBeTruthy();
  });

  // SCRUM-98 AC2, US-8.2-TC04
  it('US-8.2-TC04 shows that no coordinator has been assigned yet', async () => {
    const id = await createSubmittedRequest();

    const view = await getCoordinatorView(id, organiser);

    expect(view.current).toBeNull();
    expect(view.history).toEqual([]);
  });

  // SCRUM-98 AC3, US-8.2-TC05
  it("US-8.2-TC05 shows the new coordinator's details after a reassignment", async () => {
    const id = await createSubmittedRequest(coordinatorA);
    await reassignCoordinator(id, { coordinatorId: coordinatorB.id, actorId: manager.id });

    const view = await getCoordinatorView(id, organiser);

    expect(view.current).toMatchObject({ id: coordinatorB.id, fullName: 'Wei Lin', contactNumber: '+65 6765 4321' });
    expect(view.history[0]?.coordinatorName).toBe('Jane Tan');
  });

  it('shows a missing contact number as null rather than failing', async () => {
    const id = await createSubmittedRequest(coordinatorC);
    expect((await getCoordinatorView(id, organiser)).current?.contactNumber).toBeNull();
  });

  it('refuses an organiser who does not own the event', async () => {
    const id = await createSubmittedRequest(coordinatorA);
    await expect(getCoordinatorView(id, otherOrganiser)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses an attendee', async () => {
    const id = await createSubmittedRequest(coordinatorA);
    await expect(getCoordinatorView(id, attendee)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
