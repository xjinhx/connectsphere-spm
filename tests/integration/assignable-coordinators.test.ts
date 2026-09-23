import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { assignCoordinator, listAssignableCoordinators } from '@/domain/assignment/service';

/**
 * SCRUM-94 AC1 — the choices behind the Assign picker on the assignment queue.
 *
 * The list has one job: every name on it must be assignable, and anyone
 * assignable must be on it. A picker offering somebody assignCoordinator would
 * refuse is worse than no picker, so the last two cases here check the list and
 * the write agree.
 *
 * Runs against the local Supabase stack (`npm run db:start` + `npm run db:reset`).
 *
 * The test uses the admin client to arrange rows - that is test setup, not the
 * code under test, which never holds a client (docs/architecture.md).
 */

const supabase = createAdminClient();

let coordinatorId: string;
let dualRoleId: string;
let attendeeId: string;
let managerId: string;
const createdRequestIds: string[] = [];

async function createAccount(label: string, roles: string[]): Promise<string> {
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
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ roles, full_name: label })
    .eq('id', data.user.id);
  if (profileError) throw new Error(`could not set roles for ${label}: ${profileError.message}`);
  return data.user.id;
}

async function createSubmittedRequest(): Promise<string> {
  const { data, error } = await supabase
    .from('event_request')
    .insert({ organiser_id: managerId, client_organisation_id: null, name: 'Annual Tech Summit' })
    .select('id')
    .single();
  if (error) throw new Error(`could not create test request: ${error.message}`);
  const id = data.id as string;
  createdRequestIds.push(id);
  await supabase.from('event_request').update({ status: 'submitted' }).eq('id', id);
  return id;
}

beforeAll(async () => {
  managerId = await createAccount('Morgan Manager', ['operations_manager']);
  coordinatorId = await createAccount('Casey Coordinator', ['coordinator']);
  // An account can hold more than one role; holding coordinator is what counts.
  dualRoleId = await createAccount('Dana Dual', ['coordinator', 'venue_staff']);
  attendeeId = await createAccount('Ari Attendee', ['attendee']);
});

afterAll(async () => {
  for (const id of createdRequestIds) {
    await supabase.from('event_request').delete().eq('id', id);
  }
  for (const id of [managerId, coordinatorId, dualRoleId, attendeeId]) {
    if (id) await supabase.auth.admin.deleteUser(id);
  }
});

describe('listAssignableCoordinators', () => {
  it('includes an account holding the coordinator role', async () => {
    const ids = (await listAssignableCoordinators()).map((c) => c.id);
    expect(ids).toContain(coordinatorId);
  });

  it('includes an account that holds coordinator alongside another role', async () => {
    const ids = (await listAssignableCoordinators()).map((c) => c.id);
    expect(ids).toContain(dualRoleId);
  });

  it('leaves out accounts that are not coordinators', async () => {
    const ids = (await listAssignableCoordinators()).map((c) => c.id);
    expect(ids).not.toContain(attendeeId);
    expect(ids).not.toContain(managerId);
  });

  it('carries the name the picker shows', async () => {
    const found = (await listAssignableCoordinators()).find((c) => c.id === coordinatorId);
    expect(found?.name).toBe('Casey Coordinator');
  });

  // The list and the write must agree, or the picker offers a choice that fails.
  it('offers only people an assignment actually succeeds for', async () => {
    const coordinators = await listAssignableCoordinators();
    const mine = coordinators.filter((c) => [coordinatorId, dualRoleId].includes(c.id));
    expect(mine).toHaveLength(2);

    for (const coordinator of mine) {
      const id = await createSubmittedRequest();
      const outcome = await assignCoordinator(id, { coordinatorId: coordinator.id, actorId: managerId });
      expect(outcome.coordinatorId).toBe(coordinator.id);
    }
  });

  it('leaves out anyone an assignment would refuse', async () => {
    const id = await createSubmittedRequest();
    await expect(
      assignCoordinator(id, { coordinatorId: attendeeId, actorId: managerId }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const ids = (await listAssignableCoordinators()).map((c) => c.id);
    expect(ids).not.toContain(attendeeId);
  });
});
