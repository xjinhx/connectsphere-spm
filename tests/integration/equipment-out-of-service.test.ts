import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { assignCoordinator } from '@/domain/assignment/service';
import { createEquipmentItem, updateEquipmentItem } from '@/domain/equipment/service';
import { recordOutOfService } from '@/domain/equipment-out-of-service/service';
import { checkEquipmentAvailability, reserveEquipment } from '@/domain/equipment-reservation/service';
import { addDays } from '@/domain/equipment-reservation/policy';
import type { Role } from '@/domain/identity/roles';
import { approveEventRequest } from '@/domain/review/service';
import { todayInSingapore } from '@/domain/shared/dates';
import { createVenue } from '@/domain/venues/service';
import { ensureTestClientOrganisation, TEST_CLIENT_ORGANISATION_ID } from './fixtures/clientOrganisation';

/**
 * SCRUM-170 Exclude equipment that is unavailable, damaged or under
 * maintenance, against the local Supabase stack, with
 * 20261023102427_equipment_out_of_service applied.
 *
 * AC text is from the Jira card as updated by Change Log CL-46, summarised on
 * the B1 test case sheet:
 *   AC1 record N units as Unavailable, Damaged or Under maintenance: count
 *   saved with status, excluded from every window | AC2 a unit returned to
 *   service is included again | AC3 excluded from every future window, no end
 *   date | AC4 more units than exist, or fewer than zero: refused, quantity
 *   field identified | AC5 item's own status (SCRUM-240) not Available: no
 *   units available | AC6 availability shows 0, never negative; reservations
 *   unchanged
 *
 * Availability is read through SCRUM-167's check and SCRUM-173's reservation,
 * which both leave units out of service out. The sheet's dates hang off
 * F = 10/11/26; here F is three weeks from today and every date moves with it.
 * Each case has its own items, as on the sheet.
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
let technicalSupport: Account;
let coordinator: Account;

/** The sheet's F (10/11/26), moved to three weeks from today. */
const F = addDays(todayInSingapore(), 21);
const d = (days: number) => addDays(F, days);
/** S4-E1: booked F to F+2, so its window is F-1 to F+2. */
const E1_DATES = [d(0), d(1), d(2)];

async function createAccount(label: string, roles: Role[]): Promise<Account> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+equipoos${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  accountIds.push(data.user.id);
  const { error: profileError } = await admin.from('profiles').update({ roles, full_name: label }).eq('id', data.user.id);
  if (profileError) throw new Error(`could not set up profile for ${label}: ${profileError.message}`);
  return { userId: data.user.id, roles };
}

async function addItem(label: string, quantity = 10): Promise<string> {
  const item = await createEquipmentItem(
    { name: `${label} ${RUN}`, category: 'av', quantity, currentLocation: 'Bugis store room' },
    technicalSupport.userId,
  );
  equipmentIds.push(item.id);
  return item.id;
}

/** An Approved event with a confirmed venue booking on each of `dates`, at a venue of its own. */
async function createEvent(label: string, dates: readonly string[]): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiser.userId,
      client_organisation_id: TEST_CLIENT_ORGANISATION_ID,
      name: `${label} ${RUN}`,
      proposed_date: dates[0] ?? null,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test event: ${error?.message}`);
  eventIds.push(data.id);
  const { error: submitError } = await admin.from('event_request').update({ status: 'submitted' }).eq('id', data.id);
  if (submitError) throw new Error(`could not submit test event: ${submitError.message}`);
  await assignCoordinator(data.id, { coordinatorId: coordinator.userId, actorId: manager.userId });
  await approveEventRequest(data.id, { actorId: coordinator.userId });

  const venue = await createVenue({ name: `B1 ${label} ${RUN}`, locationId, maxCapacity: 100, operatingSlots: ['am', 'pm', 'night'] });
  venueIds.push(venue.id);
  const { error: bookingError } = await admin.from('venue_booking').insert(
    dates.map((date) => ({ venue_id: venue.id, event_request_id: data.id, date, start_time: '10:00', end_time: '18:00' })) as never,
  );
  if (bookingError) throw new Error(`could not book test event: ${bookingError.message}`);
  return data.id;
}

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

/** The units the check reports available for `equipmentId` on the event. */
async function available(eventId: string, equipmentId: string): Promise<number> {
  const { lines } = await checkEquipmentAvailability(eventId, technicalSupport);
  const line = lines.find((l) => l.equipmentId === equipmentId);
  if (!line) throw new Error('no checked line for the item');
  return line.available;
}

async function storedCounts(equipmentId: string) {
  const { data, error } = await admin
    .from('equipment')
    .select('units_unavailable, units_damaged, units_under_maintenance')
    .eq('id', equipmentId)
    .single();
  if (error) throw new Error(`could not read test item: ${error.message}`);
  return data;
}

const counts = (unavailable: number, damaged: number, underMaintenance: number) => ({ unavailable, damaged, underMaintenance });

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  const { data: location, error } = await admin.from('locations').insert({ name: `B1 OOS Location ${RUN}` }).select('id').single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;

  manager = await createAccount('manager', ['operations_manager']);
  organiser = await createAccount('organiser', ['event_organiser']);
  technicalSupport = await createAccount('technical-support', ['technical_support']);
  coordinator = await createAccount('coordinator', ['coordinator']);
});

afterAll(async () => {
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of venueIds) await admin.from('venues').delete().eq('id', id);
  for (const id of equipmentIds) await admin.from('equipment').delete().eq('id', id);
  for (const id of accountIds) await admin.auth.admin.deleteUser(id);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
});

describe('SCRUM-170 AC1 to AC3: recording units out of service', () => {
  it('TC-170-01 (AC1): 2 units recorded Unavailable are saved and excluded from every window', async () => {
    const item = await addItem('EQ-170-01');
    const e1 = await createEvent('S4-E1 170-01', E1_DATES);
    const am = await createEvent('S4-AM 170-01', [d(10)]);
    await request(e1, item, 2);
    await request(am, item, 2);

    const saved = await recordOutOfService(item, counts(2, 0, 0));

    expect(saved.counts).toEqual(counts(2, 0, 0));
    expect(await storedCounts(item)).toEqual({ units_unavailable: 2, units_damaged: 0, units_under_maintenance: 0 });
    expect(await available(e1, item)).toBe(8);
    expect(await available(am, item)).toBe(8);
  });

  it.each([
    ['TC-170-02', 'Damaged', counts(0, 2, 0)],
    ['TC-170-03', 'Under maintenance', counts(0, 0, 2)],
  ])('%s (AC1): 2 units recorded %s are excluded', async (tc, _status, recorded) => {
    const item = await addItem(`EQ-${tc}`);
    const e1 = await createEvent(`S4-E1 ${tc}`, E1_DATES);
    await request(e1, item, 2);

    await recordOutOfService(item, recorded);

    expect(await available(e1, item)).toBe(8);
  });

  it('TC-170-04 (AC2): a unit returned to service is included again', async () => {
    const item = await addItem('EQ-170-04');
    await recordOutOfService(item, counts(0, 2, 0));
    const e1 = await createEvent('S4-E1 170-04', E1_DATES);
    await request(e1, item, 2);

    await recordOutOfService(item, counts(0, 1, 0));

    expect(await available(e1, item)).toBe(9);
  });

  it('TC-170-05 (AC3): a unit out of service is excluded from a far future window too, with no end date', async () => {
    const item = await addItem('EQ-170-05');
    await recordOutOfService(item, counts(0, 0, 2));
    const far = await createEvent('S4-FAR', [d(203), d(204)]);
    await request(far, item, 2);

    expect(await available(far, item)).toBe(8);
  });
});

describe('SCRUM-170 AC4: refusing counts the item cannot have', () => {
  it('TC-170-06: recording more units than exist is refused, the field named, nothing saved', async () => {
    const item = await addItem('EQ-170-06');

    await expect(recordOutOfService(item, counts(0, 11, 0))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { fieldErrors: { damaged: ['This item has 10 units, so no more than 10 can be out of service in all.'] } },
    });
    expect(await storedCounts(item)).toEqual({ units_unavailable: 0, units_damaged: 0, units_under_maintenance: 0 });
  });

  it('TC-170-07: recording exactly as many units as exist is accepted, leaving none available', async () => {
    const item = await addItem('EQ-170-07');
    const e1 = await createEvent('S4-E1 170-07', E1_DATES);
    await request(e1, item, 2);

    await recordOutOfService(item, counts(0, 0, 10));

    expect(await available(e1, item)).toBe(0);
  });

  it('TC-170-08: the limit is on the total across statuses, not each status', async () => {
    const item = await addItem('EQ-170-08');
    await recordOutOfService(item, counts(0, 8, 0));

    await expect(recordOutOfService(item, counts(0, 8, 3))).rejects.toMatchObject({
      details: { fieldErrors: { underMaintenance: [expect.any(String)] } },
    });
    expect(await storedCounts(item)).toEqual({ units_unavailable: 0, units_damaged: 8, units_under_maintenance: 0 });
  });

  it('TC-170-11: recording fewer than zero is refused, the field named, nothing saved', async () => {
    const item = await addItem('EQ-170-11');

    await expect(recordOutOfService(item, counts(0, -1, 0))).rejects.toMatchObject({
      details: { fieldErrors: { damaged: ['Units out of service cannot be below zero.'] } },
    });
    expect(await storedCounts(item)).toEqual({ units_unavailable: 0, units_damaged: 0, units_under_maintenance: 0 });
  });

  it("the item's quantity cannot then be lowered below its units out of service (SCRUM-240's edit)", async () => {
    const item = await addItem('EQ-170-qty');
    await recordOutOfService(item, counts(0, 4, 0));

    await expect(updateEquipmentItem(item, { quantity: 3 })).rejects.toMatchObject({
      details: { fieldErrors: { quantity: ['Quantity cannot be below the units recorded out of service.'] } },
    });
  });
});

describe("SCRUM-170 AC5: the item's own status", () => {
  it.each(['damaged', 'unavailable', 'under_maintenance'] as const)(
    'TC-170-09: an item whose own status is %s has no units available, and none can be reserved',
    async (status) => {
      const item = await addItem(`EQ-170-09 ${status}`);
      await updateEquipmentItem(item, { operationalStatus: status });
      const e1 = await createEvent(`S4-E1 170-09 ${status}`, E1_DATES);
      const line = await request(e1, item, 2);

      expect(await available(e1, item)).toBe(0);
      await expect(reserveEquipment(e1, line, technicalSupport.userId, { quantity: 1 })).rejects.toMatchObject({
        code: 'UNAVAILABLE',
      });
    },
  );
});

describe('SCRUM-170 AC6: never below zero, reservations unchanged', () => {
  it('TC-170-10: 6 reserved, then 5 recorded Damaged: another event sees 0, not -1, and the 6 stay reserved', async () => {
    const item = await addItem('EQ-170-10');
    const holder = await createEvent('H-170-10', E1_DATES);
    await reserveEquipment(holder, await request(holder, item, 6), technicalSupport.userId, { quantity: 6 });
    const e1 = await createEvent('S4-E1 170-10', E1_DATES);
    await request(e1, item, 2);

    await recordOutOfService(item, counts(0, 5, 0));

    expect(await available(e1, item)).toBe(0);
    const { data } = await admin.from('equipment_reservation').select('quantity, status').eq('event_request_id', holder);
    expect(data).toEqual([{ quantity: 6, status: 'reserved' }]);
  });

  it('reserving leaves units out of service out: 2 Damaged of 10, so 9 is refused and 8 is the most', async () => {
    const item = await addItem('EQ-170-guard');
    await recordOutOfService(item, counts(0, 2, 0));
    const e1 = await createEvent('S4-E1 170-guard', E1_DATES);
    const line = await request(e1, item, 10);

    await expect(reserveEquipment(e1, line, technicalSupport.userId, { quantity: 9 })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      details: { available: 8 },
    });
    await expect(reserveEquipment(e1, line, technicalSupport.userId, { quantity: 8 })).resolves.toMatchObject({ quantity: 8 });
  });
});
