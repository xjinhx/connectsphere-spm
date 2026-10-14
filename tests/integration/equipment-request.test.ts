import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { assignCoordinator } from '@/domain/assignment/service';
import { createEquipmentItem } from '@/domain/equipment/service';
import { addEquipmentLine, getEquipmentRequest } from '@/domain/equipment-request/service';
import { changeEventStatus, enterPlanning } from '@/domain/event-status/service';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import type { Role } from '@/domain/identity/roles';
import { approveEventRequest } from '@/domain/review/service';
import { ensureTestClientOrganisation, TEST_CLIENT_ORGANISATION_ID } from './fixtures/clientOrganisation';

/**
 * SCRUM-160 Record the equipment an event needs, against the local Supabase
 * stack (`npm run db:start`, then the migrations applied).
 *
 * The rules on their own are in tests/unit/equipment-request.test.ts. What only
 * a real database can show is here: that a line really lands against the
 * event's request and is read back from the stored row, and that a refusal
 * leaves the stored request exactly as it was.
 *
 * AC text is from the Jira card (authoritative):
 *   AC1 "Given I am the assigned coordinator of an event that is Approved or
 *        in Planning, when I add an equipment type and a quantity, then the
 *        item is saved against the event's equipment request."
 *
 * Test case IDs are from the Sprint 3 sheet's SCRUM-160 tab (TC-160-nn).
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

type Account = { userId: string; roles: Role[] };

const accountIds: string[] = [];
const eventIds: string[] = [];
const equipmentIds: string[] = [];

let manager: Account;
let organiser: Account;
let technicalSupport: Account;
let coordinatorA: Account;

let projector: string;
let lectern: string;

async function createAccount(label: string, roles: Role[]): Promise<Account> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+equipreq${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  accountIds.push(data.user.id);

  const { error: profileError } = await admin.from('profiles').update({ roles, full_name: label }).eq('id', data.user.id);
  if (profileError) throw new Error(`could not set up profile for ${label}: ${profileError.message}`);
  return { userId: data.user.id, roles };
}

/**
 * An event brought to `status` the way the app gets it there: submitted,
 * assigned by an Operations Manager, approved by its coordinator, then moved
 * on through SCRUM-101's enterPlanning and SCRUM-103's changeEventStatus.
 */
async function createEvent(status: EventRequestStatus, coordinator: Account = coordinatorA): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({ organiser_id: organiser.userId, client_organisation_id: TEST_CLIENT_ORGANISATION_ID, name: `Tech Summit ${RUN}` })
    .select('id')
    .single();
  if (error) throw new Error(`could not create test event: ${error.message}`);
  const id = data.id as string;
  eventIds.push(id);

  const { error: submitError } = await admin.from('event_request').update({ status: 'submitted' }).eq('id', id);
  if (submitError) throw new Error(`could not submit test event: ${submitError.message}`);
  await assignCoordinator(id, { coordinatorId: coordinator.userId, actorId: manager.userId });
  if (status === 'submitted') return id;

  if (status === 'cancelled') {
    await changeEventStatus(id, 'cancelled');
    return id;
  }
  await approveEventRequest(id, { actorId: coordinator.userId });
  if (status === 'approved') return id;

  await enterPlanning(id);
  if (status === 'planning') return id;

  await changeEventStatus(id, 'confirmed');
  if (status === 'confirmed') return id;
  await changeEventStatus(id, 'completed');
  return id;
}

async function addItem(name: string): Promise<string> {
  const item = await createEquipmentItem(
    { name: `${name} ${RUN}`, category: 'av', quantity: 10, currentLocation: 'Bugis store room' },
    technicalSupport.userId,
  );
  equipmentIds.push(item.id);
  return item.id;
}

/** The event's stored lines, read straight from the table rather than through the service. */
async function storedLines(eventId: string) {
  const { data, error } = await admin
    .from('equipment_request_line')
    .select('id, equipment_id, quantity')
    .eq('event_request_id', eventId)
    .order('created_at');
  if (error) throw new Error(`could not read test lines: ${error.message}`);
  return data ?? [];
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  manager = await createAccount('manager', ['operations_manager']);
  organiser = await createAccount('organiser', ['event_organiser']);
  technicalSupport = await createAccount('technical-support', ['technical_support']);
  coordinatorA = await createAccount('coordinator-a', ['coordinator']);

  projector = await addItem('Projector P-100');
  lectern = await addItem('Lectern LC-1');
});

afterAll(async () => {
  // Events first (their lines go with them), then the catalogue items the lines
  // named, then the accounts: each of those is ON DELETE RESTRICT.
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of equipmentIds) await admin.from('equipment').delete().eq('id', id);
  for (const id of accountIds) await admin.auth.admin.deleteUser(id);
});

// -----------------------------------------------------------------------------
// AC1 — the item is saved against the event's equipment request
// -----------------------------------------------------------------------------

describe('SCRUM-160 AC1: adding an item to the event\'s equipment request', () => {
  it('TC-160-01 saves Projector P-100 x 2 against a Planning event and reads it back', async () => {
    const event = await createEvent('planning');

    const { line } = await addEquipmentLine(event, coordinatorA.userId, { equipmentId: projector, quantity: 2 });

    expect(await storedLines(event)).toEqual([{ id: line.id, equipment_id: projector, quantity: 2 }]);
    // "Still shows after the reload": a fresh read of the request returns it.
    const request = await getEquipmentRequest(event, coordinatorA);
    expect(request.lines).toMatchObject([{ id: line.id, equipmentName: `Projector P-100 ${RUN}`, quantity: 2 }]);
  });

  it.each<EventRequestStatus>(['completed', 'cancelled'])(
    'TC-160-02 refuses an item on a %s event and saves nothing',
    async (status) => {
      const event = await createEvent(status);

      await expect(
        addEquipmentLine(event, coordinatorA.userId, { equipmentId: projector, quantity: 2 }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(await storedLines(event)).toEqual([]);
    },
  );

  it('TC-160-03 refuses an item with no equipment type, naming the field, and saves nothing', async () => {
    const event = await createEvent('planning');

    await expect(addEquipmentLine(event, coordinatorA.userId, { quantity: 2 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { fieldErrors: { equipmentId: ['Choose an equipment type.'] } },
    });
    expect(await storedLines(event)).toEqual([]);
  });

  it('also accepts an item on an Approved event (AC1 names Approved and Planning)', async () => {
    const event = await createEvent('approved');

    await addEquipmentLine(event, coordinatorA.userId, { equipmentId: lectern, quantity: 1 });

    expect(await storedLines(event)).toMatchObject([{ equipment_id: lectern, quantity: 1 }]);
  });
});
