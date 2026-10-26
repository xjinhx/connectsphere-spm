import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createEquipmentItem } from '@/domain/equipment/service';
import { getEquipmentRequest, listEquipmentQueue, updateEquipmentRequestStatus } from '@/domain/equipment-request/service';
import type { Role } from '@/domain/identity/roles';
import { listNotifications } from '@/domain/notification/service';
import { notificationHref } from '@/domain/notification/policy';
import { ForbiddenError, ValidationError } from '@/domain/shared/errors';
import { ensureTestClientOrganisation, TEST_CLIENT_ORGANISATION_ID } from './fixtures/clientOrganisation';

/**
 * SCRUM-166 Update the status of an equipment request, against the local
 * Supabase stack (`npm run db:start`, then the migrations applied).
 *
 * The rules on their own are in tests/unit/equipment-request-status.test.ts.
 * What only a real database can show is here: that a status, who set it and
 * when, the unavailable lines and the reason are saved and read back by the
 * assigned coordinator; that a refusal leaves the stored request as it was;
 * and that the coordinator - and only the coordinator - is notified.
 *
 * AC text is from the Jira card (authoritative):
 *   AC1 "Given an equipment request has just been raised, when I first open
 *        it, then its status is under review."
 *   AC2 "Given I am reviewing an equipment request, when I set its status to
 *        partially fulfilled, fulfilled or unable to fulfil, then the new
 *        status, my identity and the timestamp are saved and shown to the
 *        assigned coordinator."
 *   AC3 "Given some requested items are available and others are not, when I
 *        set the status to partially fulfilled, then I cannot save until every
 *        unavailable item is identified."
 *   AC4 "Given I set the status to unable to fulfil, when I save, then a
 *        reason is mandatory and the coordinator is notified."
 *   AC5 moved out of Release 1 (SCRUM-176 AC4, CL-50): no test here.
 *
 * The database is shared with other tests and manual data, so every check looks
 * only at this run's events.
 *
 * Test case IDs are from the SCRUM-166 tab of the Sprint 4 sheet (TC-166-nn).
 */

vi.setConfig({ testTimeout: 20_000, hookTimeout: 60_000 });

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const accountIds: string[] = [];
const eventIds: string[] = [];
const equipmentIds: string[] = [];

let organiserId: string;
let opsManagerId: string;
let coordinatorId: string;
let coordinatorBId: string;
let techSupport: { userId: string; roles: Role[] };
let techSupport2: { userId: string; roles: Role[] };
let coordinator: { userId: string; roles: Role[] };
let projector: string;
let wirelessMic: string;

async function createAccount(label: string, fullName: string, roles: Role[]): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+equipstatus${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  accountIds.push(data.user.id);
  const { error: profileError } = await admin
    .from('profiles')
    .update({ roles, full_name: fullName })
    .eq('id', data.user.id);
  if (profileError) throw new Error(`could not set up profile for ${label}: ${profileError.message}`);
  return data.user.id;
}

async function addItem(name: string): Promise<string> {
  const item = await createEquipmentItem(
    { name: `${name} ${RUN}`, category: 'av', quantity: 10, currentLocation: 'Bugis Store Room' },
    techSupport.userId,
  );
  equipmentIds.push(item.id);
  return item.id;
}

/**
 * An event in Planning, assigned to Coordinator A, with an equipment request
 * whose lines are added in the order given. Its status is the one it was
 * raised with: under review (the column default). Returns the event and its
 * line ids, in order.
 */
async function createRequest(
  label: string,
  lines: { equipmentId: string; quantity: number }[],
): Promise<{ eventId: string; lineIds: string[] }> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: TEST_CLIENT_ORGANISATION_ID,
      name: `${label} ${RUN}`,
      purpose: 'SCRUM-166 integration test',
      status: 'planning',
      proposed_date: '2026-11-05',
      start_time: '10:00',
      end_time: '12:00',
      expected_attendance: 50,
      submitted_at: now,
      decision: 'approved',
      decided_by: opsManagerId,
      decided_at: now,
      coordinator_id: coordinatorId,
      assigned_by: opsManagerId,
      assigned_at: now,
    })
    .select('id')
    .single();
  if (error) throw new Error(`could not create test event: ${error.message}`);
  const eventId = data.id as string;
  eventIds.push(eventId);

  const { error: requestError } = await admin.from('equipment_request').insert({ event_request_id: eventId });
  if (requestError) throw new Error(`could not create test request: ${requestError.message}`);
  const lineIds: string[] = [];
  for (const line of lines) {
    const { data: saved, error: lineError } = await admin
      .from('equipment_request_line')
      .insert({
        event_request_id: eventId,
        equipment_id: line.equipmentId,
        quantity: line.quantity,
        created_by: coordinatorId,
      })
      .select('id')
      .single();
    if (lineError) throw new Error(`could not add test line: ${lineError.message}`);
    lineIds.push(saved.id as string);
  }
  return { eventId, lineIds };
}

/** EVT-A: Projector P-100 x2, Wireless Mic WM-3 x4. */
function createEvtA(label = 'EVT-A') {
  return createRequest(label, [
    { equipmentId: projector, quantity: 2 },
    { equipmentId: wirelessMic, quantity: 4 },
  ]);
}

/** The stored request row, read straight from the table. */
async function storedRequest(eventId: string) {
  const { data, error } = await admin
    .from('equipment_request')
    .select('status, status_set_by, status_set_at, unable_reason')
    .eq('event_request_id', eventId)
    .single();
  if (error) throw new Error(`could not read test request: ${error.message}`);
  return data as { status: string; status_set_by: string | null; status_set_at: string | null; unable_reason: string | null };
}

/** This run's notifications about `eventId` for `recipientId`. */
async function notificationsAbout(recipientId: string, eventId: string) {
  return (await listNotifications(recipientId)).filter((n) => n.eventRequestId === eventId);
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  organiserId = await createAccount('organiser', 'Organiser', ['event_organiser']);
  opsManagerId = await createAccount('ops-manager', 'Ops Manager', ['operations_manager']);
  coordinatorId = await createAccount('coordinator', 'Coordinator A', ['coordinator']);
  coordinatorBId = await createAccount('coordinator-b', 'Coordinator B', ['coordinator']);
  techSupport = {
    userId: await createAccount('tech-support', 'Tech Support', ['technical_support']),
    roles: ['technical_support'],
  };
  techSupport2 = {
    userId: await createAccount('tech-support-2', 'Tech Support 2', ['technical_support']),
    roles: ['technical_support'],
  };
  coordinator = { userId: coordinatorId, roles: ['coordinator'] };

  projector = await addItem('Projector P-100');
  wirelessMic = await addItem('Wireless Mic WM-3');
});

afterAll(async () => {
  // Events first (their requests, lines and notifications go with them), then
  // the catalogue items the lines named, then the accounts: each of those is
  // ON DELETE RESTRICT.
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of equipmentIds) await admin.from('equipment').delete().eq('id', id);
  for (const id of accountIds) await admin.auth.admin.deleteUser(id);
});

describe('SCRUM-166 AC1: a request just raised is under review', () => {
  it('TC-166-01 opens as Under review, with nobody named yet', async () => {
    const { eventId } = await createRequest('EVT-new', [{ equipmentId: projector, quantity: 1 }]);

    const view = await getEquipmentRequest(eventId, techSupport);

    expect(view.requestStatus).toEqual({ status: 'under_review', setByName: null, setAt: null, unableReason: null });
    expect(view.canSetStatus).toBe(true);
  });

  it('TC-166-02 opening a resolved request again does not reset it', async () => {
    const { eventId } = await createEvtA('EVT-D');
    await updateEquipmentRequestStatus(eventId, techSupport, { status: 'fulfilled' });

    await getEquipmentRequest(eventId, techSupport);
    const reopened = await getEquipmentRequest(eventId, techSupport);

    expect(reopened.requestStatus?.status).toBe('fulfilled');
    expect((await storedRequest(eventId)).status).toBe('fulfilled');
  });
});

describe('SCRUM-166 AC2: the status, who set it and when are saved and shown to the assigned coordinator', () => {
  it('TC-166-03 / TC-166-04 Fulfilled is saved with Tech Support and the time, and the coordinator sees all three', async () => {
    const { eventId } = await createEvtA();
    const before = Date.now();

    await updateEquipmentRequestStatus(eventId, techSupport, { status: 'fulfilled' });

    const stored = await storedRequest(eventId);
    expect(stored).toMatchObject({ status: 'fulfilled', status_set_by: techSupport.userId, unable_reason: null });
    expect(Date.parse(stored.status_set_at ?? '')).toBeGreaterThanOrEqual(before - 5_000);

    const seenByCoordinator = await getEquipmentRequest(eventId, coordinator);
    expect(seenByCoordinator.requestStatus).toMatchObject({ status: 'fulfilled', setByName: 'Tech Support' });
    expect(seenByCoordinator.requestStatus?.setAt).not.toBeNull();
    expect(seenByCoordinator.canSetStatus).toBe(false);
  });

  it('TC-166-05 a later change by another staff member replaces who and when', async () => {
    const { eventId, lineIds } = await createEvtA();
    await updateEquipmentRequestStatus(eventId, techSupport, {
      status: 'partially_fulfilled',
      unavailableLineIds: [lineIds[1]],
    });
    const first = await storedRequest(eventId);

    await updateEquipmentRequestStatus(eventId, techSupport2, { status: 'fulfilled' });

    const second = await storedRequest(eventId);
    expect(second).toMatchObject({ status: 'fulfilled', status_set_by: techSupport2.userId });
    expect(Date.parse(second.status_set_at ?? '')).toBeGreaterThanOrEqual(Date.parse(first.status_set_at ?? ''));
    expect((await getEquipmentRequest(eventId, coordinator)).requestStatus?.setByName).toBe('Tech Support 2');
  });

  it('TC-166-06 a resolved request can be set back to Under review, and is outstanding again', async () => {
    const { eventId } = await createEvtA('EVT-D2');
    await updateEquipmentRequestStatus(eventId, techSupport, { status: 'fulfilled' });

    await updateEquipmentRequestStatus(eventId, techSupport, { status: 'under_review' });

    expect(await storedRequest(eventId)).toMatchObject({ status: 'under_review', status_set_by: techSupport.userId });
    expect((await listEquipmentQueue()).map((entry) => entry.eventRequestId)).toContain(eventId);
  });

  it('TC-166-07 a coordinator not assigned to the event cannot see its status', async () => {
    const { eventId } = await createEvtA();
    await updateEquipmentRequestStatus(eventId, techSupport, { status: 'fulfilled' });

    await expect(getEquipmentRequest(eventId, { userId: coordinatorBId, roles: ['coordinator'] })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('TC-166-08 an unknown status is refused and the stored status is unchanged', async () => {
    const { eventId } = await createEvtA();

    for (const status of ['approved', '', 'FULFILLED']) {
      await expect(updateEquipmentRequestStatus(eventId, techSupport, { status })).rejects.toThrow(ValidationError);
    }

    expect(await storedRequest(eventId)).toMatchObject({ status: 'under_review', status_set_by: null });
  });

  it('TC-166-09 the coordinator cannot set the status, and it is unchanged', async () => {
    const { eventId } = await createEvtA();

    await expect(updateEquipmentRequestStatus(eventId, coordinator, { status: 'fulfilled' })).rejects.toThrow(
      ForbiddenError,
    );

    expect(await storedRequest(eventId)).toMatchObject({ status: 'under_review', status_set_by: null });
  });
});

describe('SCRUM-166 AC3: partially fulfilled cannot be saved until the unavailable items are identified', () => {
  it('TC-166-10 saves with the Wireless Mic marked, and the coordinator sees it listed as unavailable', async () => {
    const { eventId, lineIds } = await createEvtA();

    await updateEquipmentRequestStatus(eventId, techSupport, {
      status: 'partially_fulfilled',
      unavailableLineIds: [lineIds[1]],
    });

    const view = await getEquipmentRequest(eventId, coordinator);
    expect(view.requestStatus).toMatchObject({ status: 'partially_fulfilled', setByName: 'Tech Support' });
    expect(view.lines.map((line) => line.unavailable)).toEqual([false, true]);
  });

  it('TC-166-11 is refused with nothing marked, and nothing is saved', async () => {
    const { eventId } = await createEvtA();

    await expect(
      updateEquipmentRequestStatus(eventId, techSupport, { status: 'partially_fulfilled', unavailableLineIds: [] }),
    ).rejects.toThrow(ValidationError);

    expect(await storedRequest(eventId)).toMatchObject({ status: 'under_review', status_set_by: null });
    expect((await getEquipmentRequest(eventId, techSupport)).lines.every((line) => !line.unavailable)).toBe(true);
  });

  it('TC-166-12 saves with exactly one of two lines marked', async () => {
    const { eventId, lineIds } = await createEvtA();

    await updateEquipmentRequestStatus(eventId, techSupport, {
      status: 'partially_fulfilled',
      unavailableLineIds: [lineIds[0]],
    });

    expect((await getEquipmentRequest(eventId, techSupport)).lines.map((line) => line.unavailable)).toEqual([
      true,
      false,
    ]);
  });

  it('refuses a line from another event, and saves nothing', async () => {
    const { eventId } = await createEvtA();
    const { lineIds: otherLines } = await createEvtA('EVT-other');

    await expect(
      updateEquipmentRequestStatus(eventId, techSupport, {
        status: 'partially_fulfilled',
        unavailableLineIds: [otherLines[0]],
      }),
    ).rejects.toThrow(ValidationError);

    expect((await storedRequest(eventId)).status).toBe('under_review');
  });

  it('a later status clears the unavailable items, so the queue no longer counts them', async () => {
    const { eventId, lineIds } = await createEvtA();
    await updateEquipmentRequestStatus(eventId, techSupport, {
      status: 'partially_fulfilled',
      unavailableLineIds: lineIds,
    });

    await updateEquipmentRequestStatus(eventId, techSupport, { status: 'under_review' });

    expect((await getEquipmentRequest(eventId, techSupport)).lines.every((line) => !line.unavailable)).toBe(true);
    expect((await listEquipmentQueue()).find((entry) => entry.eventRequestId === eventId)?.unavailableCount).toBe(0);
  });
});

describe('SCRUM-166 AC4: unable to fulfil needs a reason, and the coordinator is notified', () => {
  const REASON = 'All wireless mics are out for the National Day rehearsal';

  it('TC-166-13 saves with the reason, and the assigned coordinator is notified', async () => {
    const { eventId } = await createEvtA();

    await updateEquipmentRequestStatus(eventId, techSupport, { status: 'unable_to_fulfil', reason: REASON });

    expect(await storedRequest(eventId)).toMatchObject({
      status: 'unable_to_fulfil',
      status_set_by: techSupport.userId,
      unable_reason: REASON,
    });
    expect((await getEquipmentRequest(eventId, coordinator)).requestStatus).toMatchObject({
      status: 'unable_to_fulfil',
      setByName: 'Tech Support',
      unableReason: REASON,
    });
    const [notification] = await notificationsAbout(coordinatorId, eventId);
    expect(notification).toMatchObject({ type: 'equipment_unable_to_fulfil' });
    expect(notification?.message).toContain(REASON);
    // Regression (SCRUM-241), TC-166-17: it opens the coordinator's view of the request.
    expect(notificationHref({ type: notification?.type ?? '', eventRequestId: eventId })).toBe(
      `/events/${eventId}/equipment`,
    );
  });

  it('TC-166-14 / TC-166-15 is refused with no reason or only spaces: unchanged, nobody notified', async () => {
    const { eventId } = await createEvtA();

    for (const reason of [undefined, '', '   ']) {
      await expect(
        updateEquipmentRequestStatus(eventId, techSupport, { status: 'unable_to_fulfil', reason }),
      ).rejects.toThrow(ValidationError);
    }

    expect(await storedRequest(eventId)).toMatchObject({ status: 'under_review', unable_reason: null });
    expect(await notificationsAbout(coordinatorId, eventId)).toHaveLength(0);
  });

  it('TC-166-16 only the assigned coordinator is notified', async () => {
    const { eventId } = await createEvtA();

    await updateEquipmentRequestStatus(eventId, techSupport, { status: 'unable_to_fulfil', reason: REASON });

    expect(await notificationsAbout(coordinatorId, eventId)).toHaveLength(1);
    expect(await notificationsAbout(coordinatorBId, eventId)).toHaveLength(0);
    expect(await notificationsAbout(organiserId, eventId)).toHaveLength(0);
  });

  it('the reason is not kept once the request moves on', async () => {
    const { eventId } = await createEvtA();
    await updateEquipmentRequestStatus(eventId, techSupport, { status: 'unable_to_fulfil', reason: REASON });

    await updateEquipmentRequestStatus(eventId, techSupport, { status: 'fulfilled', reason: 'ignored' });

    expect(await storedRequest(eventId)).toMatchObject({ status: 'fulfilled', unable_reason: null });
  });
});

describe('Regression: SCRUM-164 queue reads the status set here', () => {
  it('TC-166-18 a line marked unavailable counts once, whatever its quantity', async () => {
    const { eventId, lineIds } = await createEvtA();

    await updateEquipmentRequestStatus(eventId, techSupport, {
      status: 'partially_fulfilled',
      unavailableLineIds: [lineIds[1]],
    });

    expect((await listEquipmentQueue()).find((entry) => entry.eventRequestId === eventId)).toMatchObject({
      status: 'partially_fulfilled',
      unavailableCount: 1,
    });
  });

  it('TC-166-19 partially fulfilled stays in the queue; fulfilled leaves it', async () => {
    const { eventId: partial, lineIds } = await createEvtA();
    const { eventId: done } = await createEvtA('EVT-D3');

    await updateEquipmentRequestStatus(partial, techSupport, {
      status: 'partially_fulfilled',
      unavailableLineIds: [lineIds[0]],
    });
    await updateEquipmentRequestStatus(done, techSupport, { status: 'fulfilled' });

    const listed = (await listEquipmentQueue()).map((entry) => entry.eventRequestId);
    expect(listed).toContain(partial);
    expect(listed).not.toContain(done);
  });
});
