import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { assignCoordinator, listMyAssignedEvents } from '@/domain/assignment/service';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-94 — Assign an Event Coordinator to a submitted event (US-7.4).
 *
 * AC text is from the Jira card, which is authoritative.
 *
 * Runs against the local Supabase stack (`npm run db:start` + `npm run db:reset`),
 * which is also what CI's "Migrations and integration tests" job does. A real
 * database is the point: the rule that only an unassigned submitted event can be
 * assigned lives inside the UPDATE statement, so no test without Postgres can
 * prove AC5.
 *
 * The test uses the admin client to arrange rows - that is test setup, not the
 * code under test, which never holds a client (docs/architecture.md).
 *
 * Not covered here - verify manually or in a later sprint:
 *   AC1's "the assigned coordinator is notified" - there is no notification
 *        story this sprint, so nothing is sent. Flag for re-execution once the
 *        Notification System exists.
 *   AC3's "the event appears in their queue" - the queue page is SCRUM-88.
 *        This file proves the data behind it; the page is that story's to show.
 *   AC4 through the HTTP route - the middleware requires a signed-in session,
 *        so that path is covered by the manual test rather than here.
 */

const supabase = createAdminClient();

// No foreign key on this column yet: Client Organisations is its own story.
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let managerId: string;
let coordinatorId: string;
let otherCoordinatorId: string;
let attendeeId: string;
const createdRequestIds: string[] = [];

async function createAccount(label: string, roles: string[]): Promise<string> {
  // The label doubles as the person's name (AC5 reports it), so it can contain
  // spaces; the address it is built into cannot.
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const { data, error } = await supabase.auth.admin.createUser({
    email: `${slug}+${Date.now()}${Math.random().toString(36).slice(2, 8)}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
    user_metadata: { full_name: label },
  });
  if (error || !data.user) {
    throw new Error(`could not create test ${label}: ${error?.message ?? 'no user returned'}`);
  }

  // handle_new_user() creates the profile row with no roles; the roles and the
  // name are what this story reads.
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ roles, full_name: label })
    .eq('id', data.user.id);
  if (profileError) throw new Error(`could not set roles for ${label}: ${profileError.message}`);

  return data.user.id;
}

async function createEventRequest(status: 'draft' | 'submitted'): Promise<string> {
  const { data, error } = await supabase
    .from('event_request')
    .insert({
      organiser_id: managerId,
      client_organisation_id: CLIENT_ORGANISATION_ID,
      name: 'Annual Tech Summit',
    })
    .select('id')
    .single();
  if (error) throw new Error(`could not create test request: ${error.message}`);

  const id = data.id as string;
  createdRequestIds.push(id);

  if (status === 'submitted') {
    const { error: submitError } = await supabase
      .from('event_request')
      .update({ status: 'submitted' })
      .eq('id', id);
    if (submitError) throw new Error(`could not submit test request: ${submitError.message}`);
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

beforeAll(async () => {
  // SCRUM-203's FK on client_organisation_id means CLIENT_ORGANISATION_ID
  // below must be a real row, not just a placeholder uuid.
  await ensureTestClientOrganisation(supabase);

  managerId = await createAccount('ops-manager', ['operations_manager']);
  coordinatorId = await createAccount('Jane Tan', ['coordinator']);
  otherCoordinatorId = await createAccount('Sam Lee', ['coordinator']);
  attendeeId = await createAccount('attendee', ['attendee']);
});

afterAll(async () => {
  // Requests first: coordinator_id and assigned_by are ON DELETE RESTRICT, so
  // an account cannot go while an assignment of theirs is still recorded.
  for (const id of createdRequestIds) {
    await supabase.from('event_request').delete().eq('id', id);
  }
  for (const id of [managerId, coordinatorId, otherCoordinatorId, attendeeId]) {
    if (id) await supabase.auth.admin.deleteUser(id);
  }
});

describe('assignCoordinator', () => {
  // AC1
  it('records the coordinator, the manager who assigned them and the date', async () => {
    const id = await createEventRequest('submitted');

    const outcome = await assignCoordinator(id, { coordinatorId, actorId: managerId });

    expect(outcome.coordinatorId).toBe(coordinatorId);
    expect(outcome.coordinatorName).toBe('Jane Tan');
    expect(outcome.assignedBy).toBe(managerId);
    expect(outcome.assignedAt).toBeTruthy();

    const row = await readRow(id);
    expect(row.coordinator_id).toBe(coordinatorId);
    expect(row.assigned_by).toBe(managerId);
    expect(row.assigned_at).toBeTruthy();
    // Assignment happens before review: it does not move the event on.
    expect(row.status).toBe('submitted');
  });

  // AC1 — the assignment date comes from the database, not the caller.
  it('stamps the assignment date within a second of the call', async () => {
    const id = await createEventRequest('submitted');
    const before = Date.now();

    const outcome = await assignCoordinator(id, { coordinatorId, actorId: managerId });

    const stamped = new Date(outcome.assignedAt).getTime();
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);
  });

  // AC1 — "an event has status Submitted"
  it('refuses a draft, and leaves it unassigned', async () => {
    const id = await createEventRequest('draft');

    await expect(assignCoordinator(id, { coordinatorId, actorId: managerId })).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });

    expect((await readRow(id)).coordinator_id).toBeNull();
  });

  // The person assigned has to be an Event Coordinator.
  it('refuses an account that is not an Event Coordinator', async () => {
    const id = await createEventRequest('submitted');

    await expect(
      assignCoordinator(id, { coordinatorId: attendeeId, actorId: managerId }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect((await readRow(id)).coordinator_id).toBeNull();
  });

  it('refuses an account that does not exist', async () => {
    const id = await createEventRequest('submitted');

    await expect(
      assignCoordinator(id, {
        coordinatorId: '00000000-0000-0000-0000-000000000000',
        actorId: managerId,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('reports an unknown event as not found', async () => {
    await expect(
      assignCoordinator('00000000-0000-0000-0000-000000000000', {
        coordinatorId,
        actorId: managerId,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reports a malformed id as not found rather than failing on the query', async () => {
    await expect(
      assignCoordinator('not-a-uuid', { coordinatorId, actorId: managerId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // AC2
  it('assigns a fourth event to a coordinator who already holds three', async () => {
    for (let held = 0; held < 3; held += 1) {
      const id = await createEventRequest('submitted');
      await assignCoordinator(id, { coordinatorId: otherCoordinatorId, actorId: managerId });
    }

    const fourth = await createEventRequest('submitted');
    const outcome = await assignCoordinator(fourth, {
      coordinatorId: otherCoordinatorId,
      actorId: managerId,
    });

    expect(outcome.coordinatorId).toBe(otherCoordinatorId);
  });

  // AC5
  it('refuses a second assignment and names who holds the event', async () => {
    const id = await createEventRequest('submitted');
    await assignCoordinator(id, { coordinatorId, actorId: managerId });

    await expect(
      assignCoordinator(id, { coordinatorId: otherCoordinatorId, actorId: managerId }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'This event is already assigned to Jane Tan.',
      details: { coordinatorId, coordinatorName: 'Jane Tan' },
    });

    expect((await readRow(id)).coordinator_id).toBe(coordinatorId);
  });

  // AC5 — the case the guard exists for: two managers at the same moment.
  it('records exactly one assignment when two managers assign at once', async () => {
    const id = await createEventRequest('submitted');

    const results = await Promise.allSettled([
      assignCoordinator(id, { coordinatorId, actorId: managerId }),
      assignCoordinator(id, { coordinatorId: otherCoordinatorId, actorId: managerId }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'CONFLICT' });

    // Whichever won, the row holds that one assignment and no other.
    const row = await readRow(id);
    expect([coordinatorId, otherCoordinatorId]).toContain(row.coordinator_id);
    expect(row.assigned_by).toBe(managerId);
  });
});

describe('listMyAssignedEvents', () => {
  // AC3
  it('returns the events a coordinator owns, and none of anybody else’s', async () => {
    const mine = await createEventRequest('submitted');
    const theirs = await createEventRequest('submitted');
    await assignCoordinator(mine, { coordinatorId, actorId: managerId });
    await assignCoordinator(theirs, { coordinatorId: otherCoordinatorId, actorId: managerId });

    const events = await listMyAssignedEvents(coordinatorId);
    const ids = events.map((event) => event.id);

    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
    expect(events.every((event) => event.assignedAt !== null)).toBe(true);
  });

  it('returns nothing for an account that owns no events', async () => {
    expect(await listMyAssignedEvents(attendeeId)).toEqual([]);
  });
});
