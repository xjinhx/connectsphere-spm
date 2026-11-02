import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { assignCoordinator } from '@/domain/assignment/service';
import { createEquipmentItem, getEquipmentItem } from '@/domain/equipment/service';
import { recordOutOfService } from '@/domain/equipment-out-of-service/service';
import { NOT_SUITABLE_REASON_MESSAGE, unmetRequirements } from '@/domain/equipment-request/policy';
import {
  completeEquipmentReview,
  getEquipmentRequest,
  saveEquipmentSuitability,
  updateEquipmentLineQuantity,
} from '@/domain/equipment-request/service';
import { CHECK_NEEDS_APPROVED_BOOKING_MESSAGE } from '@/domain/equipment-reservation/schema';
import { checkEquipmentAvailability } from '@/domain/equipment-reservation/service';
import { addDays } from '@/domain/equipment-reservation/policy';
import type { Role } from '@/domain/identity/roles';
import { approveEventRequest } from '@/domain/review/service';
import { todayInSingapore } from '@/domain/shared/dates';
import { ForbiddenError, ValidationError } from '@/domain/shared/errors';
import { createVenue } from '@/domain/venues/service';
import { ensureTestClientOrganisation, TEST_CLIENT_ORGANISATION_ID } from './fixtures/clientOrganisation';

/**
 * SCRUM-171 Assess whether requested equipment is suitable for the event,
 * against the local Supabase stack, with
 * 20261026001500_equipment_suitability_review applied.
 *
 * The rules on their own are in tests/unit/equipment-suitability.test.ts. What
 * only a real database can show is here: that each item's verdict, reason and
 * who marked it are saved and read back by the assigned coordinator; that a
 * refusal leaves every item as it was; and that completing the review runs
 * SCRUM-167's real checkEquipmentAvailability - units out of service included
 * - to decide whether the request is ready to reserve.
 *
 * AC text is from the Jira card (authoritative):
 *   AC1 "Given an equipment requirement recorded against an event, when I
 *        review it, then I can mark each requested item suitable or not
 *        suitable and record why."
 *   AC2 "Given I mark an item not suitable, when I save the review, then it
 *        appears on the request as an unmet requirement with my reason."
 *        Updated 22 Oct 2026: it no longer changes the available quantity
 *        (SCRUM-167 owns it, CL-50).
 *   AC3 moved to SCRUM-176 (CL-50): no test here.
 *   AC4 "Given every requested item is marked suitable and is available for
 *        the commitment window, when I complete the review, then the request
 *        is marked ready to reserve."
 *
 * Every case has its own catalogue items, at the sheet's quantities
 * (Projector P-100 10, Wireless Mic WM-3 4, Lectern LC-1 5), and its own event,
 * booked three weeks from today so the window is never in the past. The
 * database is shared with other tests and manual data, so every check looks
 * only at this run's rows.
 *
 * Test case IDs are from the SCRUM-171 tab of the Sprint 4 sheet (TC-171-nn).
 */

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

type Account = { userId: string; roles: Role[] };

const accountIds: string[] = [];
const eventIds: string[] = [];
const venueIds: string[] = [];
const equipmentIds: string[] = [];
let locationId: string;

let manager: Account;
let organiser: Account;
let techSupport: Account;
let coordinator: Account;

/** EVT-A's booking day, three weeks from today: its window is the day before to this day. */
const EVENT_DATE = addDays(todayInSingapore(), 21);

async function createAccount(label: string, fullName: string, roles: Role[]): Promise<Account> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+suitability${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  accountIds.push(data.user.id);
  const { error: profileError } = await admin.from('profiles').update({ roles, full_name: fullName }).eq('id', data.user.id);
  if (profileError) throw new Error(`could not set up profile for ${label}: ${profileError.message}`);
  return { userId: data.user.id, roles };
}

async function addItem(name: string, quantity: number): Promise<string> {
  const item = await createEquipmentItem(
    { name: `${name} ${RUN} ${equipmentIds.length}`, category: 'av', quantity, currentLocation: 'Bugis Store Room' },
    techSupport.userId,
  );
  equipmentIds.push(item.id);
  return item.id;
}

/**
 * An Approved event assigned to the coordinator, with a confirmed venue booking
 * on EVENT_DATE (none when `booked` is false), at a venue of its own.
 */
async function createEvent(label: string, booked = true): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiser.userId,
      client_organisation_id: TEST_CLIENT_ORGANISATION_ID,
      name: `${label} ${RUN}`,
      proposed_date: EVENT_DATE,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test event: ${error?.message}`);
  eventIds.push(data.id);
  const { error: submitError } = await admin.from('event_request').update({ status: 'submitted' }).eq('id', data.id);
  if (submitError) throw new Error(`could not submit test event: ${submitError.message}`);
  await assignCoordinator(data.id, { coordinatorId: coordinator.userId, actorId: manager.userId });
  await approveEventRequest(data.id, { actorId: coordinator.userId });

  if (booked) {
    const venue = await createVenue({
      name: `S171 ${label} ${RUN}`,
      locationId,
      maxCapacity: 100,
      operatingSlots: ['am', 'pm', 'night'],
    });
    venueIds.push(venue.id);
    const { error: bookingError } = await admin
      .from('venue_booking')
      .insert({ venue_id: venue.id, event_request_id: data.id, date: EVENT_DATE, start_time: '10:00', end_time: '12:00' } as never);
    if (bookingError) throw new Error(`could not book test event: ${bookingError.message}`);
  }
  return data.id;
}

/** Adds a line to the event's equipment request, as its coordinator would. */
async function request(eventId: string, equipmentId: string, quantity: number): Promise<string> {
  await admin.from('equipment_request').upsert({ event_request_id: eventId }, { onConflict: 'event_request_id' });
  const { data, error } = await admin
    .from('equipment_request_line')
    .insert({ event_request_id: eventId, equipment_id: equipmentId, quantity, created_by: coordinator.userId })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not add test line: ${error?.message}`);
  return data.id;
}

/**
 * EVT-A, as on the sheet: Projector P-100 ×2 (10 in the catalogue), Wireless
 * Mic WM-3 ×`mic` (4), Lectern LC-1 ×`lectern` (5). Each call has its own items.
 */
async function createEvtA(label: string, quantities: { mic?: number; lectern?: number; booked?: boolean } = {}) {
  const items = {
    projector: await addItem('Projector P-100', 10),
    mic: await addItem('Wireless Mic WM-3', 4),
    lectern: await addItem('Lectern LC-1', 5),
  };
  const eventId = await createEvent(label, quantities.booked ?? true);
  const lines = {
    projector: await request(eventId, items.projector, 2),
    mic: await request(eventId, items.mic, quantities.mic ?? 4),
    lectern: await request(eventId, items.lectern, quantities.lectern ?? 1),
  };
  return { eventId, items, lines };
}

type Lines = Awaited<ReturnType<typeof createEvtA>>['lines'];

/** Every item marked suitable, with a reason. */
const allSuitable = (lines: Lines) => ({
  verdicts: [
    { lineId: lines.projector, suitability: 'suitable', reason: 'Bright enough for the seminar room' },
    { lineId: lines.mic, suitability: 'suitable', reason: 'Enough for the panel' },
    { lineId: lines.lectern, suitability: 'suitable', reason: 'One speaker at a time' },
  ],
});

/** The stored verdict on one line, read straight from the table. */
async function storedLine(lineId: string) {
  const { data, error } = await admin
    .from('equipment_request_line')
    .select('suitability, suitability_reason, suitability_set_by, suitability_set_at')
    .eq('id', lineId)
    .single();
  if (error) throw new Error(`could not read test line: ${error.message}`);
  return data as {
    suitability: string | null;
    suitability_reason: string | null;
    suitability_set_by: string | null;
    suitability_set_at: string | null;
  };
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  const { data: location, error } = await admin.from('locations').insert({ name: `S171 Location ${RUN}` }).select('id').single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;

  manager = await createAccount('manager', 'Manager', ['operations_manager']);
  organiser = await createAccount('organiser', 'Organiser', ['event_organiser']);
  techSupport = await createAccount('tech-support', 'Tech Support', ['technical_support']);
  coordinator = await createAccount('coordinator', 'Coordinator A', ['coordinator']);
});

afterAll(async () => {
  // Events first (their requests, lines and bookings go with them), then what
  // they named: each of those is ON DELETE RESTRICT.
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of venueIds) await admin.from('venues').delete().eq('id', id);
  for (const id of equipmentIds) await admin.from('equipment').delete().eq('id', id);
  for (const id of accountIds) await admin.auth.admin.deleteUser(id);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
});

describe('SCRUM-171 AC1: mark each item suitable or not suitable and record why', () => {
  it('TC-171-01 saves both verdicts and reasons per item, with who marked them, and reads them back', async () => {
    const { eventId, lines } = await createEvtA('EVT-A 01');

    await saveEquipmentSuitability(eventId, techSupport, {
      verdicts: [
        { lineId: lines.projector, suitability: 'suitable', reason: 'Bright enough for the seminar room' },
        { lineId: lines.mic, suitability: 'not_suitable', reason: 'Panel needs lapel mics' },
      ],
    });

    const view = await getEquipmentRequest(eventId, techSupport);
    expect(view.lines.map((l) => [l.suitability, l.suitabilityReason])).toEqual([
      ['suitable', 'Bright enough for the seminar room'],
      ['not_suitable', 'Panel needs lapel mics'],
      [null, null],
    ]);
    const stored = await storedLine(lines.mic);
    expect(stored.suitability_set_by).toBe(techSupport.userId);
    expect(stored.suitability_set_at).not.toBeNull();
    expect(view.canReview).toBe(true);
  });

  it('TC-171-02 refuses not suitable with no reason, and saves nothing from that review', async () => {
    const { eventId, lines } = await createEvtA('EVT-A 02');

    await expect(
      saveEquipmentSuitability(eventId, techSupport, {
        verdicts: [
          { lineId: lines.projector, suitability: 'suitable', reason: 'Fine' },
          { lineId: lines.mic, suitability: 'not_suitable', reason: '' },
        ],
      }),
    ).rejects.toMatchObject({
      message: NOT_SUITABLE_REASON_MESSAGE,
      details: { fieldErrors: { reason: [NOT_SUITABLE_REASON_MESSAGE] }, lineIds: [lines.mic] },
    });
    expect((await storedLine(lines.mic)).suitability).toBeNull();
    expect((await storedLine(lines.projector)).suitability).toBeNull();
  });

  it('TC-171-03 saves suitable with no reason', async () => {
    const { eventId, lines } = await createEvtA('EVT-A 03');

    await saveEquipmentSuitability(eventId, techSupport, { verdicts: [{ lineId: lines.projector, suitability: 'suitable', reason: '' }] });

    expect(await storedLine(lines.projector)).toMatchObject({ suitability: 'suitable', suitability_reason: null });
  });

  it('TC-171-04 refuses a reason of only spaces, as with an empty one', async () => {
    const { eventId, lines } = await createEvtA('EVT-A 04');

    await expect(
      saveEquipmentSuitability(eventId, techSupport, { verdicts: [{ lineId: lines.mic, suitability: 'not_suitable', reason: '   ' }] }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await storedLine(lines.mic)).suitability).toBeNull();
  });

  it('TC-171-05 refuses the assigned coordinator, and nothing is saved or completed', async () => {
    const { eventId, lines } = await createEvtA('EVT-A 05');
    const asCoordinator = { userId: coordinator.userId, roles: coordinator.roles };

    await expect(
      saveEquipmentSuitability(eventId, asCoordinator, { verdicts: [{ lineId: lines.projector, suitability: 'suitable' }] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(completeEquipmentReview(eventId, asCoordinator)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await storedLine(lines.projector)).suitability).toBeNull();
    const view = await getEquipmentRequest(eventId, asCoordinator);
    expect(view.canReview).toBe(false);
    expect(view.review).toBeNull();
  });

  it('refuses an item from another event, and saves nothing', async () => {
    const a = await createEvtA('EVT-A other-1');
    const b = await createEvtA('EVT-A other-2');

    await expect(
      saveEquipmentSuitability(a.eventId, techSupport, { verdicts: [{ lineId: b.lines.mic, suitability: 'suitable' }] }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await storedLine(b.lines.mic)).suitability).toBeNull();
  });
});

describe('SCRUM-171 AC2: an item not suitable appears on the request as an unmet requirement', () => {
  it('TC-171-06 lists Wireless Mic WM-3 ×4 with the reason, for Technical Support Staff and the coordinator', async () => {
    const { eventId, lines } = await createEvtA('EVT-A 06');

    await saveEquipmentSuitability(eventId, techSupport, {
      verdicts: [{ lineId: lines.mic, suitability: 'not_suitable', reason: 'Panel needs lapel mics' }],
    });

    for (const viewer of [techSupport, coordinator]) {
      const unmet = unmetRequirements((await getEquipmentRequest(eventId, viewer)).lines);
      expect(unmet.map((l) => [l.equipmentName.startsWith('Wireless Mic WM-3'), l.quantity, l.suitabilityReason])).toEqual([
        [true, 4, 'Panel needs lapel mics'],
      ]);
    }
  });

  it('TC-171-07 does not change the available quantity: still 4 in the catalogue and 4 available for the window', async () => {
    const { eventId, items, lines } = await createEvtA('EVT-A 07');
    const before = (await checkEquipmentAvailability(eventId, techSupport)).lines.find((l) => l.lineId === lines.mic);

    await saveEquipmentSuitability(eventId, techSupport, {
      verdicts: [{ lineId: lines.mic, suitability: 'not_suitable', reason: 'Panel needs lapel mics' }],
    });

    const after = (await checkEquipmentAvailability(eventId, techSupport)).lines.find((l) => l.lineId === lines.mic);
    expect(before?.available).toBe(4);
    expect(after?.available).toBe(4);
    expect((await getEquipmentItem(items.mic)).quantity).toBe(4);
  });

  it('TC-171-08 marking it suitable again takes it off, keeping only the current verdict and reason', async () => {
    const { eventId, lines } = await createEvtA('EVT-A 08');
    await saveEquipmentSuitability(eventId, techSupport, {
      verdicts: [{ lineId: lines.mic, suitability: 'not_suitable', reason: 'Panel needs lapel mics' }],
    });

    await saveEquipmentSuitability(eventId, techSupport, {
      verdicts: [{ lineId: lines.mic, suitability: 'suitable', reason: 'Lapel mics confirmed not needed' }],
    });

    const view = await getEquipmentRequest(eventId, coordinator);
    expect(unmetRequirements(view.lines)).toEqual([]);
    expect(await storedLine(lines.mic)).toMatchObject({ suitability: 'suitable', suitability_reason: 'Lapel mics confirmed not needed' });
  });
});

describe('SCRUM-171 AC4: completing the review marks the request ready to reserve', () => {
  it('TC-171-10 every item suitable and available (2 of 10, 4 of 4, 1 of 5): ready to reserve', async () => {
    const { eventId, lines } = await createEvtA('EVT-A 10');
    await saveEquipmentSuitability(eventId, techSupport, allSuitable(lines));

    const outcome = await completeEquipmentReview(eventId, techSupport);

    expect(outcome.notReady).toEqual([]);
    expect(outcome.request.review).toMatchObject({ readyToReserve: true, completedByName: 'Tech Support' });
    // The coordinator sees the same mark.
    expect((await getEquipmentRequest(eventId, coordinator)).review?.readyToReserve).toBe(true);
  });

  it('TC-171-11 one item not suitable: not ready to reserve', async () => {
    const { eventId, lines } = await createEvtA('EVT-A 11');
    await saveEquipmentSuitability(eventId, techSupport, {
      verdicts: [
        { lineId: lines.projector, suitability: 'suitable' },
        { lineId: lines.mic, suitability: 'not_suitable', reason: 'Panel needs lapel mics' },
        { lineId: lines.lectern, suitability: 'suitable' },
      ],
    });

    const outcome = await completeEquipmentReview(eventId, techSupport);

    expect(outcome.request.review?.readyToReserve).toBe(false);
    expect(outcome.notReady.map((r) => r.kind)).toEqual(['not_suitable']);
  });

  it('TC-171-12 every item suitable but Lectern LC-1 6 of 5: not ready, the lectern short by 1', async () => {
    const { eventId, lines } = await createEvtA('EVT-A 12', { lectern: 6 });
    await saveEquipmentSuitability(eventId, techSupport, allSuitable(lines));

    const outcome = await completeEquipmentReview(eventId, techSupport);

    expect(outcome.request.review?.readyToReserve).toBe(false);
    expect(outcome.notReady).toEqual([{ kind: 'short', message: expect.stringMatching(/^Lectern LC-1 .* is short by 1 /) }]);
  });

  it('TC-171-13 the mic at 4 of 4 is ready; changed to 5 of 4 and completed again, it is not', async () => {
    const { eventId, lines } = await createEvtA('EVT-A 13');
    await saveEquipmentSuitability(eventId, techSupport, allSuitable(lines));
    expect((await completeEquipmentReview(eventId, techSupport)).request.review?.readyToReserve).toBe(true);

    await updateEquipmentLineQuantity(eventId, lines.mic, coordinator.userId, { quantity: 5 });
    const outcome = await completeEquipmentReview(eventId, techSupport);

    expect(outcome.request.review?.readyToReserve).toBe(false);
    expect(outcome.notReady).toEqual([{ kind: 'short', message: expect.stringMatching(/^Wireless Mic WM-3 .* is short by 1 /) }]);
  });

  it('TC-171-14 one item unmarked: the review completes, not ready to reserve', async () => {
    const { eventId, lines } = await createEvtA('EVT-A 14');
    await saveEquipmentSuitability(eventId, techSupport, {
      verdicts: [
        { lineId: lines.projector, suitability: 'suitable' },
        { lineId: lines.mic, suitability: 'suitable' },
      ],
    });

    const outcome = await completeEquipmentReview(eventId, techSupport);

    expect(outcome.request.review).toMatchObject({ readyToReserve: false, completedByName: 'Tech Support' });
    expect(outcome.notReady.map((r) => r.kind)).toEqual(['unmarked']);
  });

  it('TC-171-17 every item suitable, but 1 mic damaged leaves 3 of 4: not ready, the mic short by 1', async () => {
    const { eventId, items, lines } = await createEvtA('EVT-A 17');
    await recordOutOfService(items.mic, { unavailable: 0, damaged: 1, underMaintenance: 0 });
    await saveEquipmentSuitability(eventId, techSupport, allSuitable(lines));

    const outcome = await completeEquipmentReview(eventId, techSupport);

    expect(outcome.request.review?.readyToReserve).toBe(false);
    expect(outcome.notReady).toEqual([{ kind: 'short', message: expect.stringMatching(/^Wireless Mic WM-3 .* is short by 1 /) }]);
    // The catalogue still says 4: AC4 reads what is available, not the quantity.
    expect((await getEquipmentItem(items.mic)).quantity).toBe(4);
  });

  it('no approved venue booking, so no commitment window: not ready, saying why', async () => {
    const { eventId, lines } = await createEvtA('EVT-A no booking', { booked: false });
    await saveEquipmentSuitability(eventId, techSupport, allSuitable(lines));

    const outcome = await completeEquipmentReview(eventId, techSupport);

    expect(outcome.request.review?.readyToReserve).toBe(false);
    expect(outcome.notReady).toEqual([{ kind: 'no_window', message: CHECK_NEEDS_APPROVED_BOOKING_MESSAGE }]);
  });
});
