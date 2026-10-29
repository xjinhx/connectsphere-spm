import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { createAdminClient } from '@/lib/supabase/admin';
import { assignCoordinator } from '@/domain/assignment/service';
import { createEquipmentItem } from '@/domain/equipment/service';
import { RELEASE_RESERVATION_REASON_REQUIRED } from '@/domain/equipment-reservation/schema';
import {
  checkEquipmentAvailability,
  listEventReservations,
  releaseEquipmentReservation,
  reserveEquipment,
} from '@/domain/equipment-reservation/service';
import { addDays } from '@/domain/equipment-reservation/policy';
import type { Role } from '@/domain/identity/roles';
import { approveEventRequest } from '@/domain/review/service';
import { ConflictError, ValidationError } from '@/domain/shared/errors';
import { todayInSingapore } from '@/domain/shared/dates';
import { createVenue } from '@/domain/venues/service';
import { POST as releaseRoute } from '@/app/api/event-requests/[id]/equipment-reservations/[reservationId]/release/route';
import { ensureTestClientOrganisation, TEST_CLIENT_ORGANISATION_ID } from './fixtures/clientOrganisation';

/**
 * SCRUM-177 Release a reservation, against the local Supabase stack with
 * 20261028094938_release_equipment_reservation applied. Test case IDs are from
 * Marcus's Sprint 4 sheet (SCRUM-177 tab).
 *
 * AC1: "Given a reservation exists, when I release it and give a reason, then
 *      its status becomes Released and the quantity returns to availability
 *      for the released window."
 * AC5: "Given a reservation has been released, when the coordinator views the
 *      event, then the released reservation is shown with its release reason
 *      and date."
 *
 * The sheet books E177-A and E177-B on 10/11/2026; here they are booked three
 * weeks from today (F), so the window F-1 to F never runs against past dates.
 * Each case has its own items and events.
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
/** Venue names are unique; it.each runs the same labels more than once. */
let venueCount = 0;

let manager: Account;
let organiser: Account;
let technicalSupport: Account;
let coordinator: Account;

/** The sheet's 10/11/2026, moved to three weeks from today. */
const F = addDays(todayInSingapore(), 21);

async function createAccount(label: string, roles: Role[]): Promise<Account> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+equiprel${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  accountIds.push(data.user.id);
  const { error: profileError } = await admin.from('profiles').update({ roles, full_name: label }).eq('id', data.user.id);
  if (profileError) throw new Error(`could not set up profile for ${label}: ${profileError.message}`);
  return { userId: data.user.id, roles };
}

async function addItem(label: string, quantity: number): Promise<string> {
  const item = await createEquipmentItem(
    { name: `${label} ${RUN}`, category: 'av', quantity, currentLocation: 'Bugis store room' },
    technicalSupport.userId,
  );
  equipmentIds.push(item.id);
  return item.id;
}

/** An approved event assigned to the coordinator, booked on F at a venue of its own. */
async function createEvent(label: string): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiser.userId,
      client_organisation_id: TEST_CLIENT_ORGANISATION_ID,
      name: `${label} ${RUN}`,
      proposed_date: F,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test event: ${error?.message}`);
  eventIds.push(data.id);
  const { error: submitError } = await admin.from('event_request').update({ status: 'submitted' }).eq('id', data.id);
  if (submitError) throw new Error(`could not submit test event: ${submitError.message}`);
  await assignCoordinator(data.id, { coordinatorId: coordinator.userId, actorId: manager.userId });
  await approveEventRequest(data.id, { actorId: coordinator.userId });

  const venue = await createVenue({
    name: `B3 ${label} ${RUN} ${++venueCount}`,
    locationId,
    maxCapacity: 100,
    operatingSlots: ['am', 'pm', 'night'],
  });
  venueIds.push(venue.id);
  const { error: bookingError } = await admin
    .from('venue_booking')
    .insert({ venue_id: venue.id, event_request_id: data.id, date: F, start_time: '10:00', end_time: '12:00' } as never);
  if (bookingError) throw new Error(`could not book test event: ${bookingError.message}`);
  return data.id;
}

/** A line for `quantity` of the item, as the coordinator records it. */
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

/** A line for `quantity`, all of it reserved by Technical Support. Returns the reservation's id. */
async function reserved(eventId: string, equipmentId: string, quantity: number): Promise<string> {
  const lineId = await request(eventId, equipmentId, quantity);
  const reservation = await reserveEquipment(eventId, lineId, technicalSupport.userId, { quantity });
  return reservation.id;
}

async function stored(reservationId: string) {
  const { data, error } = await admin
    .from('equipment_reservation')
    .select('status, quantity, release_reason, released_by, released_at')
    .eq('id', reservationId)
    .single();
  if (error || !data) throw new Error(`could not read test reservation: ${error?.message}`);
  return data;
}

async function available(eventId: string, equipmentId: string): Promise<number> {
  const { lines } = await checkEquipmentAvailability(eventId, technicalSupport);
  const line = lines.find((l) => l.equipmentId === equipmentId);
  if (!line) throw new Error('no checked line for the item');
  return line.available;
}

const release = (eventId: string, reservationId: string, input: unknown) =>
  releaseEquipmentReservation(eventId, reservationId, technicalSupport.userId, input);

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  const { data: location, error } = await admin
    .from('locations')
    .insert({ name: `B3 Location ${RUN}` })
    .select('id')
    .single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;

  manager = await createAccount('manager', ['operations_manager']);
  organiser = await createAccount('organiser', ['event_organiser']);
  technicalSupport = await createAccount('technical-support', ['technical_support']);
  coordinator = await createAccount('coordinator', ['coordinator']);
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

describe('SCRUM-177 AC1: releasing a reservation with a reason', () => {
  it('TC-177-01: a reservation released with a reason is Released, with its reason, releaser and date', async () => {
    const item = await addItem('EQ-177-01', 5);
    const eventA = await createEvent('E177-A 01');
    const reservationId = await reserved(eventA, item, 4);

    const result = await release(eventA, reservationId, { reason: 'Client no longer needs projectors' });

    expect(result).toMatchObject({ status: 'released', releaseReason: 'Client no longer needs projectors' });
    expect(result.releasedAt).not.toBeNull();
    expect(await stored(reservationId)).toMatchObject({
      status: 'released',
      quantity: 4,
      release_reason: 'Client no longer needs projectors',
      released_by: technicalSupport.userId,
    });
    expect((await stored(reservationId)).released_at).not.toBeNull();
  });

  it('TC-177-02: the released units are available again to another event in the same window', async () => {
    const item = await addItem('EQ-177-01', 5);
    const eventA = await createEvent('E177-A 02');
    const reservationId = await reserved(eventA, item, 4);
    const eventB = await createEvent('E177-B 02');
    await request(eventB, item, 3);

    expect(await available(eventB, item)).toBe(1);
    await release(eventA, reservationId, { reason: 'Event scaled down' });
    expect(await available(eventB, item)).toBe(5);
  });

  it.each([
    ['TC-177-03', 'an empty reason', { reason: '' }],
    ['TC-177-03', 'no reason sent', {}],
    ['TC-177-04', 'a reason of only spaces', { reason: '   ' }],
  ])('%s: %s is refused, naming the reason; the reservation stays Reserved', async (_id, _label, input) => {
    const item = await addItem('EQ-177-01', 5);
    const eventA = await createEvent('E177-A 03');
    const reservationId = await reserved(eventA, item, 4);
    const eventB = await createEvent('E177-B 03');
    await request(eventB, item, 3);

    const refusal = await release(eventA, reservationId, input).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ValidationError);
    expect((refusal as ValidationError).details).toMatchObject({
      fieldErrors: { reason: [RELEASE_RESERVATION_REASON_REQUIRED] },
    });
    expect(await stored(reservationId)).toMatchObject({ status: 'reserved', release_reason: null });
    expect(await available(eventB, item)).toBe(1);
  });

  it("TC-177-05: releasing one reservation leaves the event's other reservations Reserved", async () => {
    const item1 = await addItem('EQ-177-01', 5);
    const item2 = await addItem('EQ-177-02', 3);
    const eventA = await createEvent('E177-A 05');
    const first = await reserved(eventA, item1, 4);
    const second = await reserved(eventA, item2, 2);

    await release(eventA, first, { reason: 'Client no longer needs projectors' });

    expect(await stored(first)).toMatchObject({ status: 'released' });
    expect(await stored(second)).toMatchObject({ status: 'reserved', quantity: 2, release_reason: null });
  });

  it('TC-177-06: a reservation already Released is refused; its first reason and date are unchanged', async () => {
    const item = await addItem('EQ-177-01', 5);
    const eventA = await createEvent('E177-A 06');
    const reservationId = await reserved(eventA, item, 4);
    await release(eventA, reservationId, { reason: 'Client no longer needs projectors' });
    const first = await stored(reservationId);

    await expect(release(eventA, reservationId, { reason: 'Second try' })).rejects.toBeInstanceOf(ConflictError);

    expect(await stored(reservationId)).toEqual(first);
  });

  it('TC-177-07: a coordinator is refused (403) through the route; the reservation stays Reserved', async () => {
    const item = await addItem('EQ-177-01', 5);
    const eventA = await createEvent('E177-A 07');
    const reservationId = await reserved(eventA, item, 4);
    vi.mocked(getCurrentActor).mockResolvedValue({
      userId: coordinator.userId,
      fullName: 'coordinator',
      roles: ['coordinator'],
      clientOrganisation: null,
    });

    const response = await releaseRoute(
      new NextRequest(`http://localhost/api/event-requests/${eventA}/equipment-reservations/${reservationId}/release`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Client no longer needs projectors' }),
      }),
      { params: Promise.resolve({ id: eventA, reservationId }) },
    );

    expect(response.status).toBe(403);
    expect(await stored(reservationId)).toMatchObject({ status: 'reserved', release_reason: null });
  });

  it("a reservation that is not the event's is not found, and is not released", async () => {
    const item = await addItem('EQ-177-01', 5);
    const eventA = await createEvent('E177-A other');
    const reservationId = await reserved(eventA, item, 4);
    const eventB = await createEvent('E177-B other');

    await expect(release(eventB, reservationId, { reason: 'Wrong event' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await stored(reservationId)).toMatchObject({ status: 'reserved' });
  });
});

describe('SCRUM-177 AC5: the coordinator sees a released reservation with its reason and date', () => {
  it('TC-177-08: the released reservation is listed for the coordinator with its reason and date', async () => {
    const item = await addItem('EQ-177-01', 5);
    const eventA = await createEvent('E177-A 08');
    const reservationId = await reserved(eventA, item, 4);
    await release(eventA, reservationId, { reason: 'Client no longer needs projectors' });

    const { reservations } = await listEventReservations(eventA, coordinator);

    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({
      equipmentName: `EQ-177-01 ${RUN}`,
      quantity: 4,
      window: { start: addDays(F, -1), end: F },
      status: 'released',
      releaseReason: 'Client no longer needs projectors',
    });
    expect(reservations[0]?.releasedAt).not.toBeNull();
  });

  it('TC-177-09: a reservation still Reserved shows no release reason or date', async () => {
    const item = await addItem('EQ-177-02', 3);
    const eventA = await createEvent('E177-A 09');
    await reserved(eventA, item, 2);

    const { reservations } = await listEventReservations(eventA, coordinator);

    expect(reservations[0]).toMatchObject({ status: 'reserved', releaseReason: null, releasedAt: null });
  });

  it('TC-177-11: a released line reserved again is Reserved, with no old release reason or date', async () => {
    const item = await addItem('EQ-177-01', 5);
    const eventA = await createEvent('E177-A 11');
    const lineId = await request(eventA, item, 4);
    const first = await reserveEquipment(eventA, lineId, technicalSupport.userId, { quantity: 4 });
    await release(eventA, first.id, { reason: 'Client no longer needs projectors' });

    await reserveEquipment(eventA, lineId, technicalSupport.userId, { quantity: 4 });
    const { reservations } = await listEventReservations(eventA, coordinator);

    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({ quantity: 4, status: 'reserved', releaseReason: null, releasedAt: null });
  });
});
