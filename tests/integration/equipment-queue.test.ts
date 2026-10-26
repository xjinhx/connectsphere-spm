import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createEquipmentItem } from '@/domain/equipment/service';
import type { EquipmentQueueEntry, EquipmentRequestStatus } from '@/domain/equipment-request/schema';
import { listEquipmentQueue, updateEquipmentRequestStatus } from '@/domain/equipment-request/service';
import type { Role } from '@/domain/identity/roles';
import { ensureTestClientOrganisation, TEST_CLIENT_ORGANISATION_ID } from './fixtures/clientOrganisation';

/**
 * SCRUM-164 Queue of equipment requests awaiting review, against the local
 * Supabase stack (`npm run db:start`, then the migrations applied).
 *
 * The rules on their own are in tests/unit/equipment-queue.test.ts. What only a
 * real database can show is here: that the queue reads the stored requests,
 * their events and lines, and that a status changed in the table changes what
 * the next read returns.
 *
 * AC text is from the Jira card (authoritative):
 *   AC1 "Given equipment requests exist that are not yet resolved, when I open
 *        my queue, then each is listed with its event, event date, requested
 *        items and quantities."
 *   AC2 "Given I sort the queue by event date, when the list reloads, then the
 *        soonest event appears first."
 *   AC3 "Given an equipment request has status fulfilled or unable to fulfil,
 *        when I open the queue, then it no longer appears as outstanding."
 *   AC4 "Given an equipment request has status partially fulfilled with at
 *        least one unavailable item, when I open the queue, then it remains
 *        listed as outstanding and shows how many items are still
 *        unavailable."
 *   AC5 "Given equipment requests exist for events at every location, when any
 *        Technical Support Staff member opens the queue, then all of them are
 *        listed, because Technical Support Staff are not scoped to particular
 *        equipment types or locations."
 *
 * Statuses and unavailable items are set through SCRUM-166's
 * updateEquipmentRequestStatus, as Technical Support Staff set them (D-19,
 * replaced: they were set by hand in the table until SCRUM-166).
 *
 * The database is shared with other tests and manual data, so every check looks
 * only at this run's events.
 *
 * Test case IDs are from the SCRUM-164 tab (TC-164-nn).
 */

vi.setConfig({ testTimeout: 20_000, hookTimeout: 60_000 });

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const accountIds: string[] = [];
const eventIds: string[] = [];
const equipmentIds: string[] = [];

let organiserId: string;
let technicalSupportId: string;
let projector: string;
let wirelessMic: string;
let lectern: string;

async function createAccount(label: string, roles: Role[]): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+equipqueue${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  accountIds.push(data.user.id);
  const { error: profileError } = await admin.from('profiles').update({ roles, full_name: label }).eq('id', data.user.id);
  if (profileError) throw new Error(`could not set up profile for ${label}: ${profileError.message}`);
  return data.user.id;
}

async function addItem(name: string, currentLocation: string): Promise<string> {
  const item = await createEquipmentItem(
    { name: `${name} ${RUN}`, category: 'av', quantity: 10, currentLocation },
    technicalSupportId,
  );
  equipmentIds.push(item.id);
  return item.id;
}

/**
 * An event with an equipment request: its lines are added in the order given,
 * so the first line is when the request was raised.
 */
async function createRequest(
  label: string,
  proposedDate: string | null,
  lines: { equipmentId: string; quantity: number }[],
): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: TEST_CLIENT_ORGANISATION_ID,
      name: `${label} ${RUN}`,
      proposed_date: proposedDate,
    })
    .select('id')
    .single();
  if (error) throw new Error(`could not create test event: ${error.message}`);
  const eventId = data.id as string;
  eventIds.push(eventId);

  const { error: requestError } = await admin.from('equipment_request').insert({ event_request_id: eventId });
  if (requestError) throw new Error(`could not create test request: ${requestError.message}`);
  for (const line of lines) {
    const { error: lineError } = await admin.from('equipment_request_line').insert({
      event_request_id: eventId,
      equipment_id: line.equipmentId,
      quantity: line.quantity,
      created_by: technicalSupportId,
    });
    if (lineError) throw new Error(`could not add test line: ${lineError.message}`);
  }
  return eventId;
}

/**
 * Sets a request's status through SCRUM-166, as Technical Support Staff do:
 * for partially fulfilled, the event's lines for `unavailable` (catalogue item
 * ids) are the ones marked unavailable; unable to fulfil is given a reason.
 */
async function setStatus(eventId: string, status: EquipmentRequestStatus, unavailable: string[] = []): Promise<void> {
  const { data, error } = await admin
    .from('equipment_request_line')
    .select('id, equipment_id')
    .eq('event_request_id', eventId);
  if (error || !data) throw new Error(`could not read test lines: ${error?.message ?? 'no lines'}`);
  const unavailableLineIds = (data as { id: string; equipment_id: string }[])
    .filter((line) => unavailable.includes(line.equipment_id))
    .map((line) => line.id);
  await updateEquipmentRequestStatus(
    eventId,
    { userId: technicalSupportId, roles: ['technical_support'] },
    { status, unavailableLineIds, reason: status === 'unable_to_fulfil' ? 'Test: none available' : null },
  );
}

/** The queue, narrowed to this run's events. */
async function queue(sort: 'raised' | 'event-date' = 'raised'): Promise<EquipmentQueueEntry[]> {
  return (await listEquipmentQueue(sort)).filter((entry) => eventIds.includes(entry.eventRequestId));
}

let evtA: string;
let evtB: string;
let evtC: string;
let evtD: string;
let evtE: string;

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  organiserId = await createAccount('organiser', ['event_organiser']);
  technicalSupportId = await createAccount('technical-support', ['technical_support']);

  // AC5: catalogue items kept at different locations.
  projector = await addItem('Projector P-100', 'Bugis Store Room');
  wirelessMic = await addItem('Wireless Mic WM-3', 'Bugis Store Room');
  lectern = await addItem('Lectern LC-1', 'Marina Bay Store Room');

  // Fixture F, raised in the order A, C, B, then D and E.
  evtA = await createRequest('EVT-A', '2026-11-05', [
    { equipmentId: projector, quantity: 2 },
    { equipmentId: wirelessMic, quantity: 4 },
  ]);
  evtC = await createRequest('EVT-C', '2026-11-12', [
    { equipmentId: projector, quantity: 1 },
    { equipmentId: wirelessMic, quantity: 2 },
    { equipmentId: lectern, quantity: 1 },
  ]);
  evtB = await createRequest('EVT-B', '2026-10-28', [
    { equipmentId: lectern, quantity: 1 },
    { equipmentId: lectern, quantity: 2 },
  ]);
  evtD = await createRequest('EVT-D', '2026-10-30', [{ equipmentId: projector, quantity: 3 }]);
  evtE = await createRequest('EVT-E', '2026-11-02', [{ equipmentId: wirelessMic, quantity: 1 }]);

  await setStatus(evtC, 'partially_fulfilled', [wirelessMic, lectern]);
  await setStatus(evtD, 'fulfilled');
  await setStatus(evtE, 'unable_to_fulfil');
});

afterAll(async () => {
  // Events first (their requests and lines go with them), then the catalogue
  // items the lines named, then the accounts: each of those is ON DELETE RESTRICT.
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of equipmentIds) await admin.from('equipment').delete().eq('id', id);
  for (const id of accountIds) await admin.auth.admin.deleteUser(id);
});

describe('SCRUM-164 AC1: each outstanding request with its event, date, items and quantities', () => {
  it('TC-164-01 lists EVT-A with its event, 5 Nov 2026 and Projector x2, Wireless Mic x4', async () => {
    const entry = (await queue()).find((e) => e.eventRequestId === evtA);
    expect(entry).toMatchObject({
      eventName: `EVT-A ${RUN}`,
      eventDate: '2026-11-05',
      status: 'under_review',
      lines: [
        { equipmentName: `Projector P-100 ${RUN}`, quantity: 2 },
        { equipmentName: `Wireless Mic WM-3 ${RUN}`, quantity: 4 },
      ],
    });
    expect(entry?.eventReference).toMatch(/\S/);
  });

  it('TC-164-02 shows the same item on two lines as two lines, not merged', async () => {
    const entry = (await queue()).find((e) => e.eventRequestId === evtB);
    expect(entry?.lines.map((line) => line.quantity)).toEqual([1, 2]);
  });

  it('does not list a request with no items: it has not been raised yet', async () => {
    const { data, error } = await admin
      .from('event_request')
      .insert({ organiser_id: organiserId, client_organisation_id: TEST_CLIENT_ORGANISATION_ID, name: `Notes only ${RUN}` })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    eventIds.push(data.id as string);
    await admin.from('equipment_request').insert({ event_request_id: data.id, technical_requirements: 'Two lapel mics' });

    expect((await queue()).map((e) => e.eventRequestId)).not.toContain(data.id);
  });
});

describe('SCRUM-164 AC2: sorted by event date', () => {
  it('TC-164-04 puts the soonest event first: EVT-B, EVT-A, EVT-C', async () => {
    const order = (await queue('event-date')).map((e) => e.eventRequestId).filter((id) => [evtA, evtB, evtC].includes(id));
    expect(order).toEqual([evtB, evtA, evtC]);
  });

  it('TC-164-06 the default order is the order raised (A, C, B), not the event date', async () => {
    const order = (await queue()).map((e) => e.eventRequestId).filter((id) => [evtA, evtB, evtC].includes(id));
    expect(order).toEqual([evtA, evtC, evtB]);
  });
});

describe('SCRUM-164 AC3: resolved requests are not outstanding', () => {
  it('TC-164-07 a fulfilled request (EVT-D) is not listed', async () => {
    expect((await queue()).map((e) => e.eventRequestId)).not.toContain(evtD);
  });

  it('TC-164-08 an unable-to-fulfil request (EVT-E) is not listed', async () => {
    expect((await queue()).map((e) => e.eventRequestId)).not.toContain(evtE);
  });

  it('TC-164-09 a request drops off as soon as its last unavailable item is resolved', async () => {
    const evtJ = await createRequest('EVT-J', '2026-11-20', [
      { equipmentId: projector, quantity: 1 },
      { equipmentId: lectern, quantity: 1 },
    ]);
    await setStatus(evtJ, 'partially_fulfilled', [lectern]);
    expect((await queue()).find((e) => e.eventRequestId === evtJ)?.unavailableCount).toBe(1);

    await setStatus(evtJ, 'fulfilled');

    expect((await queue()).map((e) => e.eventRequestId)).not.toContain(evtJ);
  });
});

describe('SCRUM-164 AC4: partially fulfilled stays listed with its unavailable count', () => {
  it('TC-164-10 EVT-C is listed and shows 2 items still unavailable, not 3', async () => {
    const entry = (await queue()).find((e) => e.eventRequestId === evtC);
    expect(entry).toMatchObject({ status: 'partially_fulfilled', unavailableCount: 2 });
    expect(entry?.lines).toHaveLength(3);
  });

  it('TC-164-12 the count is read fresh: 2 becomes 1 once an item is no longer unavailable', async () => {
    const evtK = await createRequest('EVT-K', '2026-11-25', [
      { equipmentId: projector, quantity: 1 },
      { equipmentId: wirelessMic, quantity: 2 },
      { equipmentId: lectern, quantity: 1 },
    ]);
    await setStatus(evtK, 'partially_fulfilled', [wirelessMic, lectern]);
    expect((await queue()).find((e) => e.eventRequestId === evtK)?.unavailableCount).toBe(2);

    await setStatus(evtK, 'partially_fulfilled', [lectern]);

    expect((await queue()).find((e) => e.eventRequestId === evtK)).toMatchObject({
      status: 'partially_fulfilled',
      unavailableCount: 1,
    });
  });
});

describe('SCRUM-164 AC5: not scoped to equipment type or location', () => {
  it('TC-164-13 lists requests whose items are kept at different locations and of every type asked for', async () => {
    const listed = (await queue()).map((e) => e.eventRequestId);
    // EVT-B asks only for an item kept at Marina Bay; EVT-A only for items kept at Bugis.
    expect(listed).toEqual(expect.arrayContaining([evtA, evtB, evtC]));
  });
});
