import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { approveEventRequest, rejectEventRequest } from '@/domain/review/service';
import { changeEventStatus } from '@/domain/event-status/service';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import { ensureTestClientOrganisation, TEST_CLIENT_ORGANISATION_ID } from './fixtures/clientOrganisation';

/**
 * SCRUM-103 — Prevent invalid status transitions.
 *
 * AC text is from the Jira card, which is authoritative. Runs against the local
 * Supabase stack (`npm run db:start` + `npm run db:reset`).
 *
 * tests/unit/event-status-policy.test.ts tests the rule. This tests what the
 * rule does to a stored event: a refused move leaves the status as it was
 * ("the transition is refused and the status is unchanged"), and an allowed
 * move is actually written.
 *
 * Each event is brought to its starting status the way the app gets it there -
 * submit, approve and reject through their own paths, and every later move
 * through changeEventStatus - so the rows satisfy every constraint a real one
 * would.
 */

const supabase = createAdminClient();

let coordinatorId: string;
const createdRequestIds: string[] = [];

async function createSubmittedRequest(): Promise<string> {
  const { data, error } = await supabase
    .from('event_request')
    .insert({
      organiser_id: coordinatorId,
      client_organisation_id: TEST_CLIENT_ORGANISATION_ID,
      name: 'Annual Tech Summit',
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

  return id;
}

async function createDraftRequest(): Promise<string> {
  const { data, error } = await supabase
    .from('event_request')
    .insert({
      organiser_id: coordinatorId,
      client_organisation_id: TEST_CLIENT_ORGANISATION_ID,
      name: 'Annual Tech Summit',
    })
    .select('id')
    .single();
  if (error) throw new Error(`could not create test request: ${error.message}`);
  createdRequestIds.push(data.id as string);
  return data.id as string;
}

async function createConfirmedRequest(): Promise<string> {
  const id = await createSubmittedRequest();
  await approveEventRequest(id, { actorId: coordinatorId });
  await changeEventStatus(id, 'planning');
  await changeEventStatus(id, 'confirmed');
  return id;
}

async function readStatus(id: string): Promise<EventRequestStatus> {
  const { data, error } = await supabase.from('event_request').select('status').eq('id', id).single();
  if (error) throw new Error(`could not read test request: ${error.message}`);
  return data.status as EventRequestStatus;
}

beforeAll(async () => {
  await ensureTestClientOrganisation(supabase);

  const { data, error } = await supabase.auth.admin.createUser({
    email: `coordinator+status${Date.now()}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`could not create test coordinator: ${error?.message ?? 'no user returned'}`);
  }
  coordinatorId = data.user.id;
});

afterAll(async () => {
  // Requests first: decided_by is ON DELETE RESTRICT.
  for (const id of createdRequestIds) {
    await supabase.from('event_request').delete().eq('id', id);
  }
  if (coordinatorId) await supabase.auth.admin.deleteUser(coordinatorId);
});

describe('SCRUM-103 AC1 — Draft cannot jump to Confirmed', () => {
  it('T1: refuses draft -> confirmed and the event stays Draft', async () => {
    const id = await createDraftRequest();

    await expect(changeEventStatus(id, 'confirmed')).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(await readStatus(id)).toBe('draft');
  });
});

describe('SCRUM-103 AC2 — Rejected cannot become Approved', () => {
  it('T2: refuses rejected -> approved and the event stays Rejected', async () => {
    const id = await createSubmittedRequest();
    await rejectEventRequest(id, { reason: 'Venue capacity insufficient' }, coordinatorId);

    await expect(changeEventStatus(id, 'approved')).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(await readStatus(id)).toBe('rejected');
  });
});

describe('SCRUM-103 AC3 — Cancelled is final', () => {
  it.each(['draft', 'submitted', 'approved', 'planning', 'confirmed', 'completed'] as const)(
    'T3: refuses cancelled -> %s and the event stays Cancelled',
    async (to) => {
      const id = await createSubmittedRequest();
      await changeEventStatus(id, 'cancelled');

      await expect(changeEventStatus(id, to)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
      expect(await readStatus(id)).toBe('cancelled');
    },
  );
});

describe('SCRUM-103 AC4 — Confirmed may go back to Planning', () => {
  it('T4: moves a confirmed event back to Planning', async () => {
    const id = await createConfirmedRequest();
    expect(await readStatus(id)).toBe('confirmed');

    await expect(changeEventStatus(id, 'planning')).resolves.toBe('planning');
    expect(await readStatus(id)).toBe('planning');
  });
});

describe('changeEventStatus', () => {
  it('reports an unknown event as not found', async () => {
    await expect(changeEventStatus('00000000-0000-0000-0000-000000000000', 'planning')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
