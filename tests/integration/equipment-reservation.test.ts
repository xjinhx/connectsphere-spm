import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { assignCoordinator } from '@/domain/assignment/service';
import { createEquipmentItem } from '@/domain/equipment/service';
import { getEquipmentRequest, updateEquipmentLineQuantity } from '@/domain/equipment-request/service';
import { RESERVE_NEEDS_APPROVED_BOOKING_MESSAGE } from '@/domain/equipment-reservation/schema';
import {
  checkEquipmentAvailability,
  listEventReservations,
  reserveEquipment,
} from '@/domain/equipment-reservation/service';
import { addDays } from '@/domain/equipment-reservation/policy';
import type { Role } from '@/domain/identity/roles';
import { approveEventRequest } from '@/domain/review/service';
import { todayInSingapore } from '@/domain/shared/dates';
import { createVenue } from '@/domain/venues/service';
import { ensureTestClientOrganisation, TEST_CLIENT_ORGANISATION_ID } from './fixtures/clientOrganisation';

/**
 * SCRUM-173 Reserve equipment for the full commitment window and view all
 * reservations for the event, against the local Supabase stack, with
 * 20261022004756_equipment_commitment_window (SCRUM-167) and
 * 20261022011508_reserve_equipment applied. SCRUM-167's check is in
 * tests/integration/equipment-availability.test.ts.
 *
 * AC text is from the Jira card as updated by Change Log CL-46, summarised on
 * the B1 test case sheet:
 *   AC1 enough available: reservation created for the window and quantity |
 *   AC2 no approved venue booking: refused | AC3 holds F-1 to L inclusive,
 *   free again from L+1 | AC4 reserved for a morning event: unavailable to an
 *   afternoon event that date | AC5 30-day event accepted, no cap | AC6
 *   equipment section lists item, quantity, window and status (Reserved or
 *   Released) | AC7 outstanding quantities shown separately
 *
 * The sheet's dates hang off F = 10/11/26, S4-E1's first booked day; here F
 * is three weeks from today and every date moves with it (the sheet's Offset
 * column), so the cases never run against past dates. Other events' holds
 * are reserved through the app, as Technical Support would (the sheet's "How
 * it is created"). Each case has its own items, as on the sheet.
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
let coordinator2: Account;

/** The sheet's F (10/11/26), moved to three weeks from today. */
const F = addDays(todayInSingapore(), 21);
/** A date `days` after F: d(0) is F, d(-1) is S4-E1's collection day. */
const d = (days: number) => addDays(F, days);

async function createAccount(label: string, roles: Role[]): Promise<Account> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+equipres${RUN}@connectsphere.example.com`,
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

/**
 * An event with a confirmed venue booking on each of `dates`, at a venue of
 * its own so no two events' bookings clash. `times` is the booking's period
 * each day (10:00 to 18:00 unless given). No dates: no booking at all.
 */
async function createEvent(
  label: string,
  dates: readonly string[],
  times: { start: string; end: string } = { start: '10:00', end: '18:00' },
  assignedTo: Account = coordinator,
): Promise<string> {
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
  // Approved the way the app gets it there: submitted, assigned by an
  // Operations Manager, approved by its coordinator.
  const { error: submitError } = await admin.from('event_request').update({ status: 'submitted' }).eq('id', data.id);
  if (submitError) throw new Error(`could not submit test event: ${submitError.message}`);
  await assignCoordinator(data.id, { coordinatorId: assignedTo.userId, actorId: manager.userId });
  await approveEventRequest(data.id, { actorId: assignedTo.userId });

  if (dates.length > 0) {
    const venue = await createVenue({
      name: `B1 ${label} ${RUN}`,
      locationId,
      maxCapacity: 100,
      operatingSlots: ['am', 'pm', 'night'],
    });
    venueIds.push(venue.id);
    const { error: bookingError } = await admin.from('venue_booking').insert(
      dates.map((date) => ({
        venue_id: venue.id,
        event_request_id: data.id,
        date,
        start_time: times.start,
        end_time: times.end,
      })) as never,
    );
    if (bookingError) throw new Error(`could not book test event: ${bookingError.message}`);
  }
  return data.id;
}

/** Adds a line for `quantity` of `equipmentId` to the event's equipment request, as its coordinator would. */
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

/** Another event holding `quantity` of the item, reserved through the app by Technical Support. */
async function hold(label: string, dates: readonly string[], equipmentId: string, quantity: number, times?: { start: string; end: string }) {
  const eventId = await createEvent(label, dates, times);
  const lineId = await request(eventId, equipmentId, quantity);
  await reserveEquipment(eventId, lineId, technicalSupport.userId, { quantity });
  return eventId;
}

/** The checked line for `equipmentId` on the event. */
async function checkedLine(eventId: string, equipmentId: string, actor: Account = technicalSupport) {
  const availability = await checkEquipmentAvailability(eventId, actor);
  const line = availability.lines.find((l) => l.equipmentId === equipmentId);
  if (!line) throw new Error('no checked line for the item');
  return line;
}

async function storedReservations(eventId: string) {
  const { data, error } = await admin
    .from('equipment_reservation')
    .select('quantity, window_start, window_end, status')
    .eq('event_request_id', eventId);
  if (error) throw new Error(`could not read test reservations: ${error.message}`);
  return data ?? [];
}

/** S4-E1: booked F to F+2, so its window is F-1 to F+2. */
const E1_DATES = [d(0), d(1), d(2)];

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  const { data: location, error } = await admin
    .from('locations')
    .insert({ name: `B1 Location ${RUN}` })
    .select('id')
    .single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;

  manager = await createAccount('manager', ['operations_manager']);
  organiser = await createAccount('organiser', ['event_organiser']);
  technicalSupport = await createAccount('technical-support', ['technical_support']);
  coordinator = await createAccount('coordinator', ['coordinator']);
  coordinator2 = await createAccount('coordinator2', ['coordinator']);
});

afterAll(async () => {
  // Events first (their lines, reservations and bookings go with them), then
  // what they named: each of those is ON DELETE RESTRICT.
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of venueIds) await admin.from('venues').delete().eq('id', id);
  for (const id of equipmentIds) await admin.from('equipment').delete().eq('id', id);
  for (const id of accountIds) await admin.auth.admin.deleteUser(id);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
});

// -----------------------------------------------------------------------------
// SCRUM-173 â€” reserving, and the event's equipment section
// -----------------------------------------------------------------------------

describe('SCRUM-173: reserving for the commitment window', () => {
  it('TC-173-01 (AC1, AC3): enough available, so a reservation is made for F-1 to L and the quantity', async () => {
    const item = await addItem('EQ-173-01');
    const e1 = await createEvent('S4-E1 173-01', E1_DATES);
    const line = await request(e1, item, 4);

    const reservation = await reserveEquipment(e1, line, technicalSupport.userId, { quantity: 4 });

    expect(reservation).toMatchObject({ lineId: line, quantity: 4, window: { start: d(-1), end: d(2) }, status: 'reserved' });
    expect(await storedReservations(e1)).toEqual([
      { quantity: 4, window_start: d(-1), window_end: d(2), status: 'reserved' },
    ]);
  });

  it('TC-173-02 (AC2): no venue booking at all, so the reservation is refused and none exists', async () => {
    const item = await addItem('EQ-173-02');
    const nb = await createEvent('S4-NB', []);
    const line = await request(nb, item, 2);

    await expect(reserveEquipment(nb, line, technicalSupport.userId, { quantity: 2 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: RESERVE_NEEDS_APPROVED_BOOKING_MESSAGE,
    });
    expect(await storedReservations(nb)).toEqual([]);
  });

  it('TC-173-08 (AC2): a venue booking request still Pending is not approved, so the reservation is refused', async () => {
    const item = await addItem('EQ-173-08');
    const pending = await createEvent('S4-PEND 173-08', []);
    const venue = await createVenue({ name: `B1 S4-PEND ${RUN}`, locationId, maxCapacity: 100, operatingSlots: ['am', 'pm', 'night'] });
    venueIds.push(venue.id);
    const { data: bookingRequest, error } = await admin
      .from('venue_booking_request')
      .insert({ event_request_id: pending, venue_id: venue.id, requested_by: coordinator.userId })
      .select('id')
      .single();
    if (error || !bookingRequest) throw new Error(`could not request test booking: ${error?.message}`);
    const { error: lineError } = await admin
      .from('venue_booking_request_line')
      .insert({ request_id: bookingRequest.id, date: d(0), start_time: '10:00', end_time: '18:00' } as never);
    if (lineError) throw new Error(`could not request test booking line: ${lineError.message}`);
    const line = await request(pending, item, 2);

    await expect(reserveEquipment(pending, line, technicalSupport.userId, { quantity: 2 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: RESERVE_NEEDS_APPROVED_BOOKING_MESSAGE,
    });
    expect(await storedReservations(pending)).toEqual([]);
  });

  it('TC-173-03 (AC3): reserved units are still held on L and free again from L+1', async () => {
    const item = await addItem('EQ-173-03');
    const e1 = await createEvent('S4-E1 173-03', E1_DATES);
    await reserveEquipment(e1, await request(e1, item, 4), technicalSupport.userId, { quantity: 4 });

    const collectsOnL = await createEvent('H-173-03L', [d(3)]); // collects F+2 = S4-E1's L
    await request(collectsOnL, item, 10);
    const collectsOnLPlus1 = await createEvent('H-173-03N', [d(4)]); // collects F+3 = L+1
    await request(collectsOnLPlus1, item, 10);

    expect(await checkedLine(collectsOnL, item)).toMatchObject({ available: 6 });
    expect(await checkedLine(collectsOnLPlus1, item)).toMatchObject({ available: 10 });
  });

  it('TC-173-04 (AC4): an item reserved for a morning event is unavailable to an afternoon event that date', async () => {
    const item = await addItem('EQ-173-04', 1);
    await hold('S4-AM 173-04', [d(10)], item, 1, { start: '08:00', end: '12:00' });
    const pm = await createEvent('S4-PM 173-04', [d(10)], { start: '14:00', end: '18:00' }, coordinator2);
    const line = await request(pm, item, 1);

    // The afternoon event's coordinator sees it reported as unavailable.
    expect(await checkedLine(pm, item, coordinator2)).toMatchObject({ requested: 1, available: 0, shortfall: 1 });
    // Reserving it is refused, nothing reserved and nothing offered in part.
    await expect(reserveEquipment(pm, line, technicalSupport.userId, { quantity: 1 })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      message: "This item is unavailable for the event's window.",
      details: { available: 0 },
    });
    expect(await storedReservations(pm)).toEqual([]);
  });

  it('TC-173-05 (AC5): a 30-day event is reserved with no cap', async () => {
    const item = await addItem('EQ-173-05');
    const long = await createEvent(
      'S4-LONG',
      Array.from({ length: 30 }, (_, i) => d(21 + i)),
    );
    const line = await request(long, item, 2);

    const reservation = await reserveEquipment(long, line, technicalSupport.userId, { quantity: 2 });
    expect(reservation.window).toEqual({ start: d(20), end: d(50) });
  });

  it('TC-173-06 (AC6): the equipment section lists every reservation with item, quantity, window and status', async () => {
    const itemA = await addItem('EQ-173-06A');
    const itemB = await addItem('EQ-173-06B');
    const e1 = await createEvent('S4-E1 173-06', E1_DATES);
    await reserveEquipment(e1, await request(e1, itemA, 4), technicalSupport.userId, { quantity: 4 });
    await reserveEquipment(e1, await request(e1, itemB, 2), technicalSupport.userId, { quantity: 2 });

    const { reservations } = await listEventReservations(e1, technicalSupport);
    expect(reservations.map((r) => [r.equipmentName, r.quantity, r.window, r.status])).toEqual([
      [`EQ-173-06A ${RUN}`, 4, { start: d(-1), end: d(2) }, 'reserved'],
      [`EQ-173-06B ${RUN}`, 2, { start: d(-1), end: d(2) }, 'reserved'],
    ]);
  });

  it('TC-173-07 (AC7): outstanding quantities are shown on their own', async () => {
    const itemA = await addItem('EQ-173-07A');
    const itemB = await addItem('EQ-173-07B', 4);
    const e1 = await createEvent('S4-E1 173-07', E1_DATES);
    await reserveEquipment(e1, await request(e1, itemA, 4), technicalSupport.userId, { quantity: 4 });
    await reserveEquipment(e1, await request(e1, itemB, 6), technicalSupport.userId, { quantity: 4 });

    const { reservations, outstanding } = await listEventReservations(e1, coordinator);
    expect(reservations.map((r) => r.quantity)).toEqual([4, 4]);
    expect(outstanding).toMatchObject([{ equipmentName: `EQ-173-07B ${RUN}`, requested: 6, reserved: 4, outstanding: 2 }]);
  });

  it('TC-173-09 (AC6): a released reservation is listed with status Released', async () => {
    const item = await addItem('EQ-173-09');
    const e1 = await createEvent('S4-E1 173-09', E1_DATES);
    const line = await request(e1, item, 3);
    const reservation = await reserveEquipment(e1, line, technicalSupport.userId, { quantity: 3 });
    // DUMMY(SCRUM-177) D-20: released by hand; releasing is SCRUM-177's.
    await admin.from('equipment_reservation').update({ status: 'released' }).eq('id', reservation.id);

    const { reservations, outstanding } = await listEventReservations(e1, technicalSupport);
    expect(reservations.map((r) => [r.equipmentName, r.quantity, r.window, r.status])).toEqual([
      [`EQ-173-09 ${RUN}`, 3, { start: d(-1), end: d(2) }, 'released'],
    ]);
    // A released reservation no longer holds the units, so the line is outstanding again.
    expect(outstanding).toMatchObject([{ equipmentName: `EQ-173-09 ${RUN}`, reserved: 0, outstanding: 3 }]);
  });

  it('AC4: what the event already holds is not reserved again: with 4 held elsewhere and 6 its own, nothing more is free', async () => {
    const item = await addItem('EQ-173-own');
    await hold('H-173-own', [d(0)], item, 4);
    const e1 = await createEvent('S4-E1 own', E1_DATES);
    const line = await request(e1, item, 8);
    await reserveEquipment(e1, line, technicalSupport.userId, { quantity: 6 });

    await expect(reserveEquipment(e1, line, technicalSupport.userId, { quantity: 1 })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      details: { available: 0 },
    });
  });

  it('refuses more than the line still asks for, and adds a second reservation to the first', async () => {
    const item = await addItem('EQ-173-top-up');
    const e1 = await createEvent('S4-E1 top-up', E1_DATES);
    const line = await request(e1, item, 5);

    await reserveEquipment(e1, line, technicalSupport.userId, { quantity: 3 });
    await expect(reserveEquipment(e1, line, technicalSupport.userId, { quantity: 3 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Only 2 still to reserve on this line.',
    });
    await reserveEquipment(e1, line, technicalSupport.userId, { quantity: 2 });
    expect(await storedReservations(e1)).toMatchObject([{ quantity: 5 }]);
  });

  it('lets only one of two reservations at once take the last units', async () => {
    const item = await addItem('EQ-173-race', 4);
    const first = await createEvent('S4-RACE-1', E1_DATES);
    const second = await createEvent('S4-RACE-2', E1_DATES);
    const firstLine = await request(first, item, 4);
    const secondLine = await request(second, item, 4);

    const results = await Promise.allSettled([
      reserveEquipment(first, firstLine, technicalSupport.userId, { quantity: 4 }),
      reserveEquipment(second, secondLine, technicalSupport.userId, { quantity: 4 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
  });

  it('SCRUM-160 AC8 (D-18 replaced): a line reserved through the app is reserved, and a confirmed reduction applies to its reservation', async () => {
    const item = await addItem('EQ-160-AC8');
    const e1 = await createEvent('S4-E1 160', E1_DATES);
    const line = await request(e1, item, 4);
    await reserveEquipment(e1, line, technicalSupport.userId, { quantity: 4 });

    const view = await getEquipmentRequest(e1, technicalSupport);
    expect(view.lines).toMatchObject([{ id: line, reserved: true }]);

    await expect(updateEquipmentLineQuantity(e1, line, coordinator.userId, { quantity: 2 })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await updateEquipmentLineQuantity(e1, line, coordinator.userId, { quantity: 2, confirmReservationChange: true });
    expect(await storedReservations(e1)).toMatchObject([{ quantity: 2 }]);
  });
});
