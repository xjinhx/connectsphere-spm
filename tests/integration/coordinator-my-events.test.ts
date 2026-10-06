import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { assignCoordinator, listMyAssignedEvents, reassignCoordinator } from '@/domain/assignment/service';
import { approveEventRequest, requestClarification } from '@/domain/review/service';
import { changeEventStatus, enterPlanning } from '@/domain/event-status/service';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import type { Role } from '@/domain/identity/roles';
import { ensureTestClientOrganisation, TEST_CLIENT_ORGANISATION_ID } from './fixtures/clientOrganisation';

/**
 * SCRUM-97 — View every event assigned to me, at any status.
 *
 * AC text is from the Jira card, which is authoritative. Test case IDs are
 * the SCRUM-97 sheet of the Sprint 2 test case workbook (TC-97-NN). Runs
 * against the local Supabase stack (`npm run db:start` + `npm run db:reset`).
 *
 * The My events page (src/app/my-events/page.tsx) shows exactly what
 * listMyAssignedEvents returns, so that is what is tested here. Each event is
 * brought to its status the way the app gets it there - submitted, assigned
 * by a manager (SCRUM-94), clarified or approved by its coordinator
 * (SCRUM-90/92), then moved on with enterPlanning (SCRUM-101) and
 * changeEventStatus (SCRUM-103) - so the rows satisfy every constraint a real
 * one would.
 *
 * Not covered here, verify manually:
 *   AC1 "whereas my review queue shows only those awaiting review" - that is
 *        the review queue page, /assigned-events (SCRUM-88).
 *   The pages themselves: the middleware needs a signed-in session.
 */

const supabase = createAdminClient();

interface Account {
  id: string;
  roles: Role[];
}

let organiser: Account;
let manager: Account;
let coordinatorA: Account;
let coordinatorB: Account;
const createdRequestIds: string[] = [];

async function createAccount(label: string, roles: Role[]): Promise<Account> {
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
    .update({ roles, full_name: label })
    .eq('id', data.user.id);
  if (profileError) throw new Error(`could not set up profile for ${label}: ${profileError.message}`);

  return { id: data.user.id, roles };
}

/** An event assigned to `coordinator` and brought to `status`, as described above. */
async function createAssignedEvent(
  coordinator: Account,
  status: EventRequestStatus,
  proposedDate: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('event_request')
    .insert({
      organiser_id: organiser.id,
      client_organisation_id: TEST_CLIENT_ORGANISATION_ID,
      name: 'Annual Tech Summit',
      proposed_date: proposedDate,
    })
    .select('id')
    .single();
  if (error) throw new Error(`could not create test request: ${error.message}`);

  const id = data.id as string;
  createdRequestIds.push(id);

  // Through the same path the app uses, so SCRUM-82's trigger stamps
  // submitted_at and the row satisfies its constraints.
  const { error: submitError } = await supabase.from('event_request').update({ status: 'submitted' }).eq('id', id);
  if (submitError) throw new Error(`could not submit test request: ${submitError.message}`);

  await assignCoordinator(id, { coordinatorId: coordinator.id, actorId: manager.id });

  if (status === 'clarification_requested') {
    await requestClarification(id, { note: 'Please confirm the expected headcount.' }, coordinator.id);
  }
  if (status === 'approved' || status === 'planning' || status === 'confirmed') {
    await approveEventRequest(id, { actorId: coordinator.id });
  }
  if (status === 'planning' || status === 'confirmed') await enterPlanning(id);
  if (status === 'confirmed') await changeEventStatus(id, 'confirmed');

  return id;
}

async function myEventIds(coordinator: Account): Promise<string[]> {
  return (await listMyAssignedEvents(coordinator.id)).map((event) => event.id);
}

beforeAll(async () => {
  await ensureTestClientOrganisation(supabase);

  organiser = await createAccount('Olivia Organiser', ['event_organiser']);
  manager = await createAccount('Mia Manager', ['operations_manager']);
  coordinatorA = await createAccount('Jane Tan', ['coordinator']);
  coordinatorB = await createAccount('Wei Lin', ['coordinator']);
});

afterAll(async () => {
  // Requests first: history and clarification rounds cascade with them, and
  // every account reference is ON DELETE RESTRICT.
  for (const id of createdRequestIds) {
    await supabase.from('event_request').delete().eq('id', id);
  }
  for (const account of [organiser, manager, coordinatorA, coordinatorB]) {
    if (account) await supabase.auth.admin.deleteUser(account.id);
  }
});

describe('SCRUM-97 AC1 — every event assigned to me, at any status', () => {
  // The five statuses the AC names, each with its own proposed date so a
  // mix-up between events would show.
  const AC1_EVENTS = [
    { status: 'submitted', proposedDate: '2026-11-02' },
    { status: 'clarification_requested', proposedDate: '2026-11-09' },
    { status: 'approved', proposedDate: '2026-11-16' },
    { status: 'planning', proposedDate: '2026-11-23' },
    { status: 'confirmed', proposedDate: '2026-11-30' },
  ] as const;
  const created: { id: string; status: EventRequestStatus; proposedDate: string }[] = [];

  beforeAll(async () => {
    for (const { status, proposedDate } of AC1_EVENTS) {
      created.push({ id: await createAssignedEvent(coordinatorA, status, proposedDate), status, proposedDate });
    }
  });

  // Split as the workbook splits it: the Sprint 1 statuses, then the two that
  // only SCRUM-103 can reach.
  it.each<[string, EventRequestStatus[]]>([
    ['TC-97-01', ['submitted', 'clarification_requested', 'approved']],
    ['TC-97-02', ['planning', 'confirmed']],
  ])('%s: lists my %j events, each with its status and proposed date', async (_id, statuses) => {
    const mine = await listMyAssignedEvents(coordinatorA.id);

    for (const { id, status, proposedDate } of created.filter((event) => statuses.includes(event.status))) {
      expect(mine.find((event) => event.id === id)).toMatchObject({ status, proposedDate });
    }
  });
});

describe('SCRUM-97 AC2 — events assigned to other coordinators', () => {
  it('TC-97-05: does not show an event assigned to another coordinator', async () => {
    const id = await createAssignedEvent(coordinatorB, 'approved', '2026-12-07');

    expect(await myEventIds(coordinatorA)).not.toContain(id);
    // It is a real, listed event - just not mine.
    expect(await myEventIds(coordinatorB)).toContain(id);
  });
});

describe('SCRUM-97 AC3 — an event reassigned away from me', () => {
  it('TC-97-06: no longer shows an event once it has been reassigned to another coordinator', async () => {
    const id = await createAssignedEvent(coordinatorA, 'planning', '2026-12-14');
    expect(await myEventIds(coordinatorA)).toContain(id);

    await reassignCoordinator(id, {
      coordinatorId: coordinatorB.id,
      fromCoordinatorId: coordinatorA.id,
      actorId: manager.id,
    });

    expect(await myEventIds(coordinatorA)).not.toContain(id);
    expect(await myEventIds(coordinatorB)).toContain(id);
  });
});
