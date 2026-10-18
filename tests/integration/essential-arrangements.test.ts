import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEssentialArrangements, recordEssentialArrangements } from '@/domain/essential-arrangements/service';
import { CONFIRMED_REFUSAL } from '@/domain/essential-arrangements/policy';
import { changeEventStatus } from '@/domain/event-status/service';
import { ConflictError, ForbiddenError, ValidationError } from '@/domain/shared/errors';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-100 Record which arrangements are essential for an event (Jira,
 * authoritative):
 *   AC1 the assigned coordinator of an Approved or Planning event stores the set;
 *   AC2 an event with nothing essential shows no outstanding essential arrangements;
 *   AC3 a Confirmed event refuses a change until it is returned to Planning.
 *
 * Runs against the local Supabase stack. Test case IDs are from the Sprint 3
 * sheet's SCRUM-100 tab (TC-100-nn). Other roles being refused at the route
 * (TC-100-03) is tests/unit/essential-arrangements-route.test.ts.
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

const AC1_SET = { venue: 'essential', equipment: 'not_required', technicalSupport: 'not_required', registration: 'not_required' } as const;
const NONE_ESSENTIAL = { venue: 'not_required', equipment: 'not_required', technicalSupport: 'not_required', registration: 'not_required' } as const;

let coordinatorId: string;
let otherCoordinatorId: string;
let organiserId: string;
const eventIds: string[] = [];

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+essential${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  return data.user.id;
}

/** An Approved event assigned to the coordinator, then moved on to `status` if given. */
async function createEvent(status: EventRequestStatus = 'approved'): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({ organiser_id: organiserId, client_organisation_id: CLIENT_ORGANISATION_ID, name: `Essential Event ${RUN}` })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test event: ${error?.message}`);
  eventIds.push(data.id);
  const steps: Record<string, unknown>[] = [{ status: 'submitted' }, { coordinator_id: coordinatorId, assigned_by: coordinatorId }];
  if (status === 'rejected') {
    steps.push({ status: 'rejected', decision: 'rejected', decided_by: coordinatorId, rejection_reason: 'Not this year' });
  } else if (status !== 'submitted') {
    steps.push({ status: 'approved', decision: 'approved', decided_by: coordinatorId });
    if (status !== 'approved') steps.push({ status });
  }
  for (const patch of steps) {
    const { error: stepError } = await admin.from('event_request').update(patch).eq('id', data.id);
    if (stepError) throw new Error(`could not prepare test event: ${stepError.message}`);
  }
  return data.id;
}

async function storedRow(eventId: string) {
  const { data } = await admin
    .from('event_essential_arrangements')
    .select('venue, equipment, technical_support, registration, recorded_by')
    .eq('event_request_id', eventId)
    .maybeSingle();
  return data;
}

async function statusOf(eventId: string) {
  const { data } = await admin.from('event_request').select('status').eq('id', eventId).single();
  return data!.status;
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  coordinatorId = await createUser('coordinator');
  otherCoordinatorId = await createUser('other-coordinator');
  organiserId = await createUser('organiser');
});

afterAll(async () => {
  // The sets go with their events (cascade).
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of [coordinatorId, otherCoordinatorId, organiserId]) if (id) await admin.auth.admin.deleteUser(id);
});

describe('AC1: the assigned coordinator stores the essential set', () => {
  it('TC-100-01 stores venue essential and the rest not required on an Approved event', async () => {
    const eventId = await createEvent('approved');

    await recordEssentialArrangements(eventId, coordinatorId, AC1_SET);

    expect(await storedRow(eventId)).toEqual({
      venue: true,
      equipment: false,
      technical_support: false,
      registration: false,
      recorded_by: coordinatorId,
    });
    // Read back the way the page reads it.
    const view = await getEssentialArrangements(eventId, coordinatorId);
    expect(view.needs).toEqual(AC1_SET);
    expect(view.essential).toEqual(['venue']);
  });

  it('TC-100-02 on a Planning event, a new set replaces the old one and the status stays Planning', async () => {
    const eventId = await createEvent('planning');
    await recordEssentialArrangements(eventId, coordinatorId, { ...AC1_SET, equipment: 'essential' });

    await recordEssentialArrangements(eventId, coordinatorId, AC1_SET);

    const { count } = await admin
      .from('event_essential_arrangements')
      .select('*', { count: 'exact', head: true })
      .eq('event_request_id', eventId);
    expect(count).toBe(1);
    expect(await storedRow(eventId)).toMatchObject({ venue: true, equipment: false });
    expect(await statusOf(eventId)).toBe('planning');
  });

  it('TC-100-03 refuses a coordinator the event is not assigned to, and nothing is stored', async () => {
    const eventId = await createEvent('approved');

    await expect(recordEssentialArrangements(eventId, otherCoordinatorId, AC1_SET)).rejects.toThrow(ForbiddenError);
    expect(await storedRow(eventId)).toBeNull();
    expect((await getEssentialArrangements(eventId, otherCoordinatorId)).canChange).toBe(false);
  });

  it.each<EventRequestStatus>(['submitted', 'rejected', 'completed', 'cancelled'])(
    'TC-100-04 refuses an event that is %s, naming the status, and nothing is stored',
    async (status) => {
      const eventId = await createEvent(status);

      const attempt = recordEssentialArrangements(eventId, coordinatorId, AC1_SET);
      await expect(attempt).rejects.toThrow(ConflictError);
      await expect(attempt).rejects.toThrow(/Approved or in Planning/);
      expect(await storedRow(eventId)).toBeNull();
    },
  );

  it('refuses an unknown arrangement or answer, and the set is unchanged', async () => {
    const eventId = await createEvent('approved');
    await recordEssentialArrangements(eventId, coordinatorId, AC1_SET);

    await expect(recordEssentialArrangements(eventId, coordinatorId, { ...AC1_SET, catering: 'essential' })).rejects.toThrow(ValidationError);
    await expect(recordEssentialArrangements(eventId, coordinatorId, { ...AC1_SET, venue: 'optional' })).rejects.toThrow(/Venue/);
    expect(await storedRow(eventId)).toMatchObject({ venue: true, equipment: false });
  });
});

describe('AC2: nothing essential means nothing outstanding', () => {
  it('TC-100-05 an event with no set recorded has nothing essential', async () => {
    const eventId = await createEvent('approved');

    const view = await getEssentialArrangements(eventId, coordinatorId);

    expect(view.essential).toEqual([]);
    expect(view.needs).toEqual(NONE_ESSENTIAL);
    expect(view.canChange).toBe(true);
  });

  it('TC-100-06 clearing the last essential arrangement leaves nothing essential', async () => {
    const eventId = await createEvent('planning');
    await recordEssentialArrangements(eventId, coordinatorId, AC1_SET);

    await recordEssentialArrangements(eventId, coordinatorId, NONE_ESSENTIAL);

    expect((await getEssentialArrangements(eventId, coordinatorId)).essential).toEqual([]);
  });

  it('TC-100-07 an event with venue essential is not shown as having none outstanding', async () => {
    const eventId = await createEvent('approved');
    await recordEssentialArrangements(eventId, coordinatorId, AC1_SET);

    expect((await getEssentialArrangements(eventId, coordinatorId)).essential).toEqual(['venue']);
  });
});

describe('AC3: a Confirmed event refuses a change until returned to Planning', () => {
  it('TC-100-08 refuses a change on a Confirmed event, says to return it to Planning, and nothing changes', async () => {
    const eventId = await createEvent('planning');
    await recordEssentialArrangements(eventId, coordinatorId, AC1_SET);
    await changeEventStatus(eventId, 'confirmed');

    await expect(recordEssentialArrangements(eventId, coordinatorId, { ...AC1_SET, equipment: 'essential' })).rejects.toThrow(
      CONFIRMED_REFUSAL,
    );
    await expect(recordEssentialArrangements(eventId, coordinatorId, NONE_ESSENTIAL)).rejects.toThrow(ConflictError);

    expect(await storedRow(eventId)).toMatchObject({ venue: true, equipment: false });
    expect(await statusOf(eventId)).toBe('confirmed');
    // The page shows the set with no form, and why.
    const view = await getEssentialArrangements(eventId, coordinatorId);
    expect(view).toMatchObject({ essential: ['venue'], canChange: false, changeRefusal: CONFIRMED_REFUSAL });
  });

  it('TC-100-09 accepts the change once the event is returned to Planning', async () => {
    const eventId = await createEvent('planning');
    await recordEssentialArrangements(eventId, coordinatorId, AC1_SET);
    await changeEventStatus(eventId, 'confirmed');
    await expect(recordEssentialArrangements(eventId, coordinatorId, { ...AC1_SET, equipment: 'essential' })).rejects.toThrow(ConflictError);

    await changeEventStatus(eventId, 'planning');
    await recordEssentialArrangements(eventId, coordinatorId, { ...AC1_SET, equipment: 'essential' });

    expect(await storedRow(eventId)).toMatchObject({ venue: true, equipment: true });
  });

  it('TC-100-10 the database refuses a save on an event Confirmed after the service read it', async () => {
    // Stands in for the race: the service saw Planning, then the event was
    // Confirmed before the save. The function the service saves through
    // re-reads the status with the row locked, so it is called directly here
    // on an event that is now Confirmed.
    const eventId = await createEvent('planning');
    await recordEssentialArrangements(eventId, coordinatorId, AC1_SET);
    await changeEventStatus(eventId, 'confirmed');

    const { data: outcome, error } = await admin.rpc('record_essential_arrangements', {
      p_event_request_id: eventId,
      p_recorded_by: coordinatorId,
      p_venue: true,
      p_equipment: true,
      p_technical_support: false,
      p_registration: false,
    });

    expect(error).toBeNull();
    expect(outcome).toBe('confirmed');
    expect(await storedRow(eventId)).toMatchObject({ venue: true, equipment: false });
  });
});
