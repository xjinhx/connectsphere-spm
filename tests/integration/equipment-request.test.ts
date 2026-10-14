import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { assignCoordinator, reassignCoordinator } from '@/domain/assignment/service';
import { createEquipmentItem } from '@/domain/equipment/service';
import {
  addEquipmentLine,
  getEquipmentRequest,
  removeEquipmentLine,
  saveTechnicalRequirements,
  updateEquipmentLineQuantity,
} from '@/domain/equipment-request/service';
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
 *   AC2 "Given I enter a quantity that is zero or negative, when I attempt to
 *        save, then the item is not added and I am told the quantity must be
 *        at least one."
 *   AC3 "Given I add the same equipment type a second time on the same event,
 *        when I save, then a separate line is created and the existing line
 *        is shown to me so that I can merge them if that was my intent; lines
 *        are never merged automatically."
 *   AC4 "Given I am an Event Coordinator who is not assigned to the event,
 *        when I invoke an equipment-request edit on it, then it is refused
 *        and the request is unchanged."
 *   AC5 "Given I am editing an equipment request, when I enter free-text
 *        technical requirements and save, then the notes are stored with the
 *        request."
 *   AC7 "Given an equipment item has not yet been reserved, when I change its
 *        quantity or remove it, then the change is saved immediately."
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
let coordinatorB: Account;
let coordinatorC: Account;

let projector: string;
let wirelessMic: string;
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

/** The event's stored technical requirements, read straight from the table. */
async function storedNotes(eventId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('equipment_request')
    .select('technical_requirements')
    .eq('event_request_id', eventId)
    .maybeSingle();
  if (error) throw new Error(`could not read test notes: ${error.message}`);
  return (data?.technical_requirements as string | null | undefined) ?? null;
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
  coordinatorB = await createAccount('coordinator-b', ['coordinator']);
  coordinatorC = await createAccount('coordinator-c', ['coordinator']);

  projector = await addItem('Projector P-100');
  wirelessMic = await addItem('Wireless mic WM-3');
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

// -----------------------------------------------------------------------------
// AC2 — the quantity must be at least one
// -----------------------------------------------------------------------------

describe('SCRUM-160 AC2: a quantity of zero or below', () => {
  it('TC-160-04 does not add an item with quantity 0, and says it must be at least one', async () => {
    const event = await createEvent('planning');

    await expect(addEquipmentLine(event, coordinatorA.userId, { equipmentId: projector, quantity: 0 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Quantity must be at least one.',
      details: { fieldErrors: { quantity: ['Quantity must be at least one.'] } },
    });
    expect(await storedLines(event)).toEqual([]);
  });

  it('TC-160-05 adds an item with quantity 1', async () => {
    const event = await createEvent('planning');

    await addEquipmentLine(event, coordinatorA.userId, { equipmentId: lectern, quantity: 1 });

    expect(await storedLines(event)).toMatchObject([{ equipment_id: lectern, quantity: 1 }]);
  });

  it('TC-160-06 refuses changing a line to 0, and the line keeps its quantity', async () => {
    const event = await createEvent('planning');
    const { line } = await addEquipmentLine(event, coordinatorA.userId, { equipmentId: projector, quantity: 2 });

    await expect(updateEquipmentLineQuantity(event, line.id, coordinatorA.userId, { quantity: 0 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Quantity must be at least one.',
    });
    expect(await storedLines(event)).toMatchObject([{ id: line.id, quantity: 2 }]);
  });

  it('the database refuses 0 on its own, as the backstop', async () => {
    const event = await createEvent('planning');
    await addEquipmentLine(event, coordinatorA.userId, { equipmentId: projector, quantity: 1 });

    const { error } = await admin
      .from('equipment_request_line')
      .insert({ event_request_id: event, equipment_id: projector, quantity: 0, created_by: coordinatorA.userId });
    expect(error?.code).toBe('23514');
  });
});

// -----------------------------------------------------------------------------
// AC3 — the same type twice is two lines, and the existing one is shown
// -----------------------------------------------------------------------------

describe('SCRUM-160 AC3: adding the same equipment type again', () => {
  it('TC-160-07 creates a second line and shows the existing one', async () => {
    const event = await createEvent('planning');
    const { line: first } = await addEquipmentLine(event, coordinatorA.userId, { equipmentId: projector, quantity: 2 });

    const outcome = await addEquipmentLine(event, coordinatorA.userId, { equipmentId: projector, quantity: 3 });

    expect(outcome.line).toMatchObject({ equipmentId: projector, quantity: 3 });
    expect(outcome.line.id).not.toBe(first.id);
    expect(outcome.sameTypeLines).toEqual([first]);
  });

  it('TC-160-08 keeps the two lines apart: no single x 5 line is ever stored', async () => {
    const event = await createEvent('planning');
    await addEquipmentLine(event, coordinatorA.userId, { equipmentId: projector, quantity: 2 });
    await addEquipmentLine(event, coordinatorA.userId, { equipmentId: projector, quantity: 3 });

    const stored = await storedLines(event);
    expect(stored.map((line) => line.quantity)).toEqual([2, 3]);
    expect(stored.every((line) => line.equipment_id === projector)).toBe(true);
    // And a fresh read of the request shows both, still apart.
    const request = await getEquipmentRequest(event, coordinatorA);
    expect(request.lines.map((line) => line.quantity)).toEqual([2, 3]);
  });

  it('TC-160-09 shows no existing line when a different type is added', async () => {
    const event = await createEvent('planning');
    await addEquipmentLine(event, coordinatorA.userId, { equipmentId: projector, quantity: 2 });

    const outcome = await addEquipmentLine(event, coordinatorA.userId, { equipmentId: wirelessMic, quantity: 2 });

    expect(outcome.sameTypeLines).toEqual([]);
    expect(await storedLines(event)).toHaveLength(2);
  });

  it('shows no existing line for the same type on a different event', async () => {
    const event = await createEvent('planning');
    const other = await createEvent('planning');
    await addEquipmentLine(other, coordinatorA.userId, { equipmentId: projector, quantity: 2 });

    const outcome = await addEquipmentLine(event, coordinatorA.userId, { equipmentId: projector, quantity: 1 });

    expect(outcome.sameTypeLines).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// AC4 — a coordinator not assigned to the event is refused
// -----------------------------------------------------------------------------

describe('SCRUM-160 AC4: a coordinator who is not assigned to the event', () => {
  it('TC-160-10 cannot add an item, and the request is unchanged', async () => {
    const event = await createEvent('planning');

    await expect(
      addEquipmentLine(event, coordinatorB.userId, { equipmentId: projector, quantity: 2 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'This event is not assigned to you.' });
    expect(await storedLines(event)).toEqual([]);
  });

  it('TC-160-11 cannot change a quantity or remove a line, and the line is unchanged', async () => {
    const event = await createEvent('planning');
    const { line } = await addEquipmentLine(event, coordinatorA.userId, { equipmentId: projector, quantity: 2 });

    await expect(updateEquipmentLineQuantity(event, line.id, coordinatorB.userId, { quantity: 5 })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(removeEquipmentLine(event, line.id, coordinatorB.userId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await storedLines(event)).toEqual([{ id: line.id, equipment_id: projector, quantity: 2 }]);
  });

  it('TC-160-11 cannot save the notes, and they still read as before', async () => {
    const event = await createEvent('planning');
    await saveTechnicalRequirements(event, coordinatorA.userId, { technicalRequirements: 'HDMI to lectern' });

    await expect(
      saveTechnicalRequirements(event, coordinatorB.userId, { technicalRequirements: 'changed' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await storedNotes(event)).toBe('HDMI to lectern');
  });

  it('TC-160-12 refuses a coordinator reassigned away, and lets the new one add', async () => {
    const event = await createEvent('planning');
    await reassignCoordinator(event, {
      coordinatorId: coordinatorC.userId,
      fromCoordinatorId: coordinatorA.userId,
      actorId: manager.userId,
    });

    await expect(
      addEquipmentLine(event, coordinatorA.userId, { equipmentId: lectern, quantity: 1 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await addEquipmentLine(event, coordinatorC.userId, { equipmentId: lectern, quantity: 1 });

    expect(await storedLines(event)).toMatchObject([{ equipment_id: lectern, quantity: 1 }]);
  });

  it('is refused before the status check: an unassigned coordinator is not told the event is closed', async () => {
    const event = await createEvent('cancelled');

    await expect(
      addEquipmentLine(event, coordinatorB.userId, { equipmentId: projector, quantity: 2 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

// -----------------------------------------------------------------------------
// AC5 — technical requirements are stored with the request
// -----------------------------------------------------------------------------

describe('SCRUM-160 AC5: technical requirements', () => {
  it('TC-160-13 stores the notes with the request, and a fresh read shows them', async () => {
    const event = await createEvent('planning');
    await addEquipmentLine(event, coordinatorA.userId, { equipmentId: projector, quantity: 2 });
    const notes = 'HDMI to the stage lectern; 2 handheld mics with spare batteries';

    await saveTechnicalRequirements(event, coordinatorA.userId, { technicalRequirements: notes });

    expect(await storedNotes(event)).toBe(notes);
    expect((await getEquipmentRequest(event, coordinatorA)).technicalRequirements).toBe(notes);
  });

  it('TC-160-14 stores multi-line notes with special characters exactly as typed', async () => {
    const event = await createEvent('planning');
    const notes = 'Line 1: Power <near> stage\nLine 2: "Q&A" mic\nLine 3: 13A sockets x4';

    await saveTechnicalRequirements(event, coordinatorA.userId, { technicalRequirements: notes });

    expect(await storedNotes(event)).toBe(notes);
  });

  it('TC-160-15 leaves the stored notes as they were until a save', async () => {
    const event = await createEvent('planning');
    await saveTechnicalRequirements(event, coordinatorA.userId, { technicalRequirements: 'HDMI to lectern' });

    // 'Rear projection only' is typed and the page left without saving: no save
    // call is made. The form half of this is checked by hand on the page.
    const request = await getEquipmentRequest(event, coordinatorA);

    expect(request.technicalRequirements).toBe('HDMI to lectern');
    expect(await storedNotes(event)).toBe('HDMI to lectern');
  });

  it('saving the notes leaves the equipment lines alone', async () => {
    const event = await createEvent('planning');
    const { line } = await addEquipmentLine(event, coordinatorA.userId, { equipmentId: projector, quantity: 2 });

    await saveTechnicalRequirements(event, coordinatorA.userId, { technicalRequirements: 'Rear projection only' });

    expect(await storedLines(event)).toEqual([{ id: line.id, equipment_id: projector, quantity: 2 }]);
  });
});

// -----------------------------------------------------------------------------
// AC7 — an unreserved item is changed or removed immediately
// -----------------------------------------------------------------------------

describe('SCRUM-160 AC7: changing or removing an unreserved item', () => {
  it('TC-160-19 saves a quantity change and a removal at once, with no confirmation step', async () => {
    const event = await createEvent('planning');
    const { line: projectorLine } = await addEquipmentLine(event, coordinatorA.userId, { equipmentId: projector, quantity: 2 });
    const { line: micLine } = await addEquipmentLine(event, coordinatorA.userId, { equipmentId: wirelessMic, quantity: 4 });

    // One call each: nothing asks for a confirmation first.
    await updateEquipmentLineQuantity(event, projectorLine.id, coordinatorA.userId, { quantity: 5 });
    await removeEquipmentLine(event, micLine.id, coordinatorA.userId);

    expect(await storedLines(event)).toEqual([{ id: projectorLine.id, equipment_id: projector, quantity: 5 }]);
  });

  it('TC-160-20 saves a reduction of an unreserved item at once', async () => {
    const event = await createEvent('planning');
    const { line } = await addEquipmentLine(event, coordinatorA.userId, { equipmentId: projector, quantity: 5 });

    const changed = await updateEquipmentLineQuantity(event, line.id, coordinatorA.userId, { quantity: 3 });

    expect(changed.quantity).toBe(3);
    expect(await storedLines(event)).toMatchObject([{ id: line.id, quantity: 3 }]);
  });

  it("refuses a line that belongs to another event's request, and changes nothing", async () => {
    const event = await createEvent('planning');
    const other = await createEvent('planning');
    const { line } = await addEquipmentLine(other, coordinatorA.userId, { equipmentId: projector, quantity: 2 });

    await expect(updateEquipmentLineQuantity(event, line.id, coordinatorA.userId, { quantity: 9 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(removeEquipmentLine(event, line.id, coordinatorA.userId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await storedLines(other)).toMatchObject([{ id: line.id, quantity: 2 }]);
  });
});
