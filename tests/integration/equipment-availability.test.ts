import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { assignCoordinator } from '@/domain/assignment/service';
import { createEquipmentItem } from '@/domain/equipment/service';
import { CHECK_NEEDS_APPROVED_BOOKING_MESSAGE } from '@/domain/equipment-reservation/schema';
import { checkEquipmentAvailability } from '@/domain/equipment-reservation/service';
import { addDays } from '@/domain/equipment-reservation/policy';
import type { Role } from '@/domain/identity/roles';
import { approveEventRequest } from '@/domain/review/service';
import { todayInSingapore } from '@/domain/shared/dates';
import { createVenue } from '@/domain/venues/service';
import { ensureTestClientOrganisation, TEST_CLIENT_ORGANISATION_ID } from './fixtures/clientOrganisation';

/**
 * SCRUM-167 Check equipment availability across the full commitment window,
 * against the local Supabase stack, with
 * 20261022004756_equipment_commitment_window applied.
 *
 * AC text is from the Jira card as updated by Change Log CL-46, summarised on
 * the B1 test case sheet:
 *   AC1 window F-1 to L inclusive, free again from L+1 | AC2 committed on F-1
 *   is not available | AC3 no approved venue booking: refused | AC4 shows
 *   requested, already reserved, available and shortfall (0 when covered);
 *   own reservations not counted against the event | AC5 overlap on any day
 *   reduces availability | AC6 morning and afternoon on the same date share
 *   the window | AC7 Return Day at least one day before my collection: all
 *   available | AC8 Return Day on my collection day: not available | AC9 holds
 *   on different days count against the busiest single day
 *   Definitions: available = the item's quantity, minus units out of service
 *   (SCRUM-170), minus the most units committed to other events on any single
 *   day of the window.
 *
 * The sheet's dates hang off F = 10/11/26, S4-E1's first booked day; here F
 * is three weeks from today and every date moves with it (the sheet's Offset
 * column), so the cases never run against past dates.
 *
 * Reservations are inserted directly as test data, the sheet's "or inserted by
 * the seed script" (reserving through the app is SCRUM-173's, tested in
 * tests/integration/equipment-reservation.test.ts): a row naming a line holds
 * the line's quantity, or the one given, for its event's whole commitment
 * window. The check reads those rows for real. Each case has
 * its own items, as on the sheet.
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
    email: `${label}+equipavail${RUN}@connectsphere.example.com`,
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
 * An Approved event with a confirmed venue booking on each of `dates`, at a
 * venue of its own so no two events' bookings clash. `times` is the booking's
 * period each day (10:00 to 18:00 unless given). No dates: no booking at all.
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

/**
 * Reserves `quantity` of the line directly, as test data, for its event's
 * commitment window (the fill trigger works the window out).
 */
async function reserveByHand(lineId: string, quantity: number): Promise<string> {
  const { data, error } = await admin
    .from('equipment_reservation')
    .insert({ line_id: lineId, quantity } as never)
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not reserve test line: ${error?.message}`);
  return (data as { id: string }).id;
}

/** Another event holding `quantity` of the item: requested and reserved. */
async function hold(label: string, dates: readonly string[], equipmentId: string, quantity: number, times?: { start: string; end: string }) {
  const eventId = await createEvent(label, dates, times);
  const lineId = await request(eventId, equipmentId, quantity);
  return reserveByHand(lineId, quantity);
}

/** The checked line for `equipmentId` on the event. */
async function checkedLine(eventId: string, equipmentId: string, actor: Account = technicalSupport) {
  const availability = await checkEquipmentAvailability(eventId, actor);
  const line = availability.lines.find((l) => l.equipmentId === equipmentId);
  if (!line) throw new Error('no checked line for the item');
  return line;
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

describe('SCRUM-167: checking availability across the commitment window', () => {
  it('TC-167-01 (AC1): units held by an event collecting on L+1 are not counted', async () => {
    const item = await addItem('EQ-167-01');
    await hold('H-167-01', [d(4), d(5)], item, 4); // collects on F+3 = S4-E1's L+1
    const e1 = await createEvent('S4-E1 167-01', E1_DATES);
    await request(e1, item, 2);

    const availability = await checkEquipmentAvailability(e1, technicalSupport);
    expect(availability.window).toEqual({ start: d(-1), end: d(2) });
    expect(availability.lines[0]).toMatchObject({ requested: 2, alreadyReserved: 0, available: 10, shortfall: 0 });
  });

  it('TC-167-02 (AC2, AC8): units whose Return Day is my collection day are not available', async () => {
    const item = await addItem('EQ-167-02');
    await hold('H-167-02', [d(-2), d(-1)], item, 4); // Return Day F-1
    const e1 = await createEvent('S4-E1 167-02', E1_DATES);
    await request(e1, item, 8);

    expect(await checkedLine(e1, item)).toMatchObject({ requested: 8, available: 6, shortfall: 2 });
  });

  it('TC-167-03 (AC3): an event with no approved venue booking is refused, nothing checked', async () => {
    const item = await addItem('EQ-167-03');
    const pending = await createEvent('S4-PEND', []);
    await request(pending, item, 2);

    await expect(checkEquipmentAvailability(pending, technicalSupport)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: CHECK_NEEDS_APPROVED_BOOKING_MESSAGE,
    });
  });

  it('AC3: a booking that has been released no longer counts as approved', async () => {
    const released = await createEvent('S4-REL', [d(0)]);
    await admin
      .from('venue_booking')
      .update({ status: 'released', release_reason: 'Test', released_by: coordinator.userId, released_at: new Date().toISOString() })
      .eq('event_request_id', released);

    await expect(checkEquipmentAvailability(released, technicalSupport)).rejects.toMatchObject({
      message: CHECK_NEEDS_APPROVED_BOOKING_MESSAGE,
    });
  });

  it('TC-167-04 (AC4): a fully covered request shows a shortfall of 0', async () => {
    const item = await addItem('EQ-167-04');
    const e1 = await createEvent('S4-E1 167-04', E1_DATES);
    await request(e1, item, 2);

    expect(await checkedLine(e1, item)).toMatchObject({ requested: 2, alreadyReserved: 0, available: 10, shortfall: 0 });
  });

  it('TC-167-05 (AC4): a partly available request shows its shortfall', async () => {
    const item = await addItem('EQ-167-05');
    await hold('H-167-05', [d(0), d(1)], item, 6);
    const e1 = await createEvent('S4-E1 167-05', E1_DATES);
    await request(e1, item, 6);

    expect(await checkedLine(e1, item)).toMatchObject({ requested: 6, alreadyReserved: 0, available: 4, shortfall: 2 });
  });

  it("TC-167-06 (AC4): the event's own reservation is shown and not counted against it", async () => {
    const item = await addItem('EQ-167-06');
    const e1 = await createEvent('S4-E1 167-06', E1_DATES);
    const line = await request(e1, item, 6);
    await reserveByHand(line, 4);

    // Definitions (CL-46): only other events' units are taken off, so the 4
    // this event holds are part of the 10 available to it.
    expect(await checkedLine(e1, item)).toMatchObject({ requested: 6, alreadyReserved: 4, available: 10, shortfall: 0 });
  });

  it('AC4: with 4 held by another event and 6 by this one, 6 are available and 2 of the 8 requested fall short', async () => {
    const item = await addItem('EQ-167-own');
    await hold('H-167-own', [d(0)], item, 4);
    const e1 = await createEvent('S4-E1 own', E1_DATES);
    const line = await request(e1, item, 8);
    await reserveByHand(line, 6);

    expect(await checkedLine(e1, item)).toMatchObject({ requested: 8, alreadyReserved: 6, available: 6, shortfall: 2 });
  });

  it('TC-167-07 (AC5): an overlap on one day reduces availability', async () => {
    const item = await addItem('EQ-167-07');
    await hold('H-167-07', [d(3), d(4)], item, 4); // window F+2 to F+4, sharing S4-E1's L
    const e1 = await createEvent('S4-E1 167-07', E1_DATES);
    await request(e1, item, 2);

    expect(await checkedLine(e1, item)).toMatchObject({ available: 6, shortfall: 0 });
  });

  it('AC5: a released reservation no longer reduces availability', async () => {
    const item = await addItem('EQ-167-rel');
    const reservationId = await hold('H-167-rel', [d(0)], item, 4);
    await admin.from('equipment_reservation').update({ status: 'released' }).eq('id', reservationId);
    const e1 = await createEvent('S4-E1 rel', E1_DATES);
    await request(e1, item, 2);

    expect(await checkedLine(e1, item)).toMatchObject({ available: 10 });
  });

  it('TC-167-08 (AC6): morning and afternoon events on the same date share the window', async () => {
    const item = await addItem('EQ-167-08');
    await hold('S4-AM 167-08', [d(10)], item, 4, { start: '08:00', end: '12:00' });
    const pm = await createEvent('S4-PM 167-08', [d(10)], { start: '14:00', end: '18:00' });
    await request(pm, item, 2);

    expect(await checkedLine(pm, item)).toMatchObject({ available: 6 });
  });

  it('TC-167-09 (AC7): a Return Day one day before my collection day leaves every unit available', async () => {
    const item = await addItem('EQ-167-09');
    await hold('H-167-09', [d(-3), d(-2)], item, 4); // Return Day F-2
    const e1 = await createEvent('S4-E1 167-09', E1_DATES);
    await request(e1, item, 2);

    expect(await checkedLine(e1, item)).toMatchObject({ available: 10 });
  });

  it('TC-167-10 (AC9): holds on different days count against the busiest day, not the sum', async () => {
    const item = await addItem('EQ-167-10');
    await hold('H-167-10A', [d(-2), d(-1)], item, 4); // covers only F-1 of the window
    await hold('H-167-10B', [d(3), d(4)], item, 4); // covers only F+2
    const e1 = await createEvent('S4-E1 167-10', E1_DATES);
    await request(e1, item, 2);

    expect(await checkedLine(e1, item)).toMatchObject({ available: 6, shortfall: 0 });
  });

  it('shares what is available between two lines of the same item, so the same units are not promised twice', async () => {
    const item = await addItem('EQ-167-dup', 5);
    const e1 = await createEvent('S4-E1 dup', E1_DATES);
    await request(e1, item, 4);
    await request(e1, item, 4);

    const availability = await checkEquipmentAvailability(e1, technicalSupport);
    expect(availability.lines.map((l) => [l.available, l.shortfall])).toEqual([
      [5, 0],
      [5, 3],
    ]);
  });

  it("lets the event's assigned coordinator see the check, and an item with none free shows 0", async () => {
    const item = await addItem('EQ-167-coord', 1);
    await hold('S4-AM coord', [d(10)], item, 1, { start: '08:00', end: '12:00' });
    const pm = await createEvent('S4-PM coord', [d(10)], { start: '14:00', end: '18:00' }, coordinator2);
    await request(pm, item, 1);

    expect(await checkedLine(pm, item, coordinator2)).toMatchObject({ requested: 1, available: 0, shortfall: 1 });
  });

  it('is refused to a coordinator the event is not assigned to', async () => {
    const e1 = await createEvent('S4-E1 other', E1_DATES);
    await expect(checkEquipmentAvailability(e1, coordinator2)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
