import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createVenue } from '@/domain/venues/service';
import { checkVenueSuitability } from '@/domain/suitability/service';
import { todayInSingapore } from '@/domain/shared/dates';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-136 Flag a venue whose capacity is exceeded, run against stored
 * events and venues on the local Supabase stack. The rule on its own, with
 * AC5, is tests/unit/suitability-capacity.test.ts.
 *
 * AC5: a check can be for one of the event's booking requests, at that
 * request's venue (tested below). The request's own attendance is SCRUM-230's
 * (#106); until it is merged a request carries none, so these use the event's.
 *
 * Test case IDs are from Joshua's Sprint 3 sheet (TC-136-nn). The venue is the
 * sheet's S136 Hall: maximum capacity 200, Theatre 120, Banquet 100.
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let locationId: string;
let hallId: string;
let coordinatorId: string;
let otherCoordinatorId: string;
let organiserId: string;
const eventIds: string[] = [];

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+suitability${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  return data.user.id;
}

/** An event assigned to the test coordinator, with the attendance and layout given. */
async function createEvent(expectedAttendance: number | null, roomLayout: string | null): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: CLIENT_ORGANISATION_ID,
      name: `Suitability Event ${RUN}`,
      expected_attendance: expectedAttendance,
      room_layout: roomLayout,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test event: ${error?.message}`);
  eventIds.push(data.id);
  await admin.from('event_request').update({ status: 'submitted' }).eq('id', data.id);
  await admin.from('event_request').update({ coordinator_id: coordinatorId, assigned_by: coordinatorId }).eq('id', data.id);
  return data.id;
}

/** A booking request for the event at a venue, through the real database function, as the coordinator. */
async function createBookingRequest(eventId: string, venueId: string): Promise<string> {
  await admin.from('event_request').update({ status: 'approved', decision: 'approved', decided_by: coordinatorId }).eq('id', eventId);
  const date = new Date(`${todayInSingapore()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 30);
  const { data, error } = await admin.rpc('create_venue_booking_request', {
    p_event_request_id: eventId,
    p_venue_id: venueId,
    p_requested_by: coordinatorId,
    p_lines: [{ date: date.toISOString().slice(0, 10), start: '10:00', end: '12:00' }],
  });
  if (error || !data) throw new Error(`could not create test booking request: ${error?.message}`);
  return data;
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  const { data: location, error } = await admin.from('locations').insert({ name: `Suitability Location ${RUN}` }).select('id').single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;
  const hall = await createVenue({
    name: `S136 Hall ${RUN}`,
    locationId,
    maxCapacity: 200,
    layouts: [
      { layout: 'theatre', capacity: 120 },
      { layout: 'banquet', capacity: 100 },
    ],
  });
  hallId = hall.id;
  coordinatorId = await createUser('coordinator');
  otherCoordinatorId = await createUser('other-coordinator');
  organiserId = await createUser('organiser');
});

afterAll(async () => {
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  if (hallId) await admin.from('venues').delete().eq('id', hallId);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
  for (const id of [coordinatorId, otherCoordinatorId, organiserId]) if (id) await admin.auth.admin.deleteUser(id);
});

describe('checkVenueSuitability: SCRUM-136', () => {
  it('TC-136-01 AC1 marks S136 Hall not suitable for 150 in Theatre and states the shortfall of 30', async () => {
    const eventId = await createEvent(150, 'theatre');

    const result = await checkVenueSuitability(eventId, { venueId: hallId }, coordinatorId);

    expect(result.verdict).toBe('not_suitable');
    expect(result.requirements).toEqual([expect.objectContaining({ requirement: 'capacity', outcome: 'not_met', shortfall: 30 })]);
  });

  it('TC-136-03 AC2 raises no capacity failure for 100 in Banquet (capacity exactly 100)', async () => {
    const eventId = await createEvent(100, 'banquet');

    const result = await checkVenueSuitability(eventId, { venueId: hallId }, coordinatorId);

    expect(result.verdict).toBe('suitable');
    expect(result.requirements[0]?.outcome).toBe('met');
  });

  it('TC-136-05 AC3 marks it suitable with concerns and names expected attendance when none is recorded', async () => {
    const eventId = await createEvent(null, 'theatre');

    const result = await checkVenueSuitability(eventId, { venueId: hallId }, coordinatorId);

    expect(result.verdict).toBe('suitable_with_concerns');
    expect(result.requirements[0]).toMatchObject({ outcome: 'unverified', detail: 'Expected attendance is not recorded.' });
  });

  it('TC-136-06 AC4 uses the maximum capacity (200) when no layout is required, so 150 fits', async () => {
    const eventId = await createEvent(150, null);

    const result = await checkVenueSuitability(eventId, { venueId: hallId }, coordinatorId);

    expect(result.verdict).toBe('suitable');
    expect(result.requirements[0]?.venueValue).toBe('200 (maximum capacity)');
  });

  it('TC-136-07 AC4 is not suitable one over the maximum capacity', async () => {
    const eventId = await createEvent(201, null);

    const result = await checkVenueSuitability(eventId, { venueId: hallId }, coordinatorId);

    expect(result.verdict).toBe('not_suitable');
    expect(result.requirements[0]?.shortfall).toBe(1);
  });

  it("refuses a coordinator the event is not assigned to, as a booking request does", async () => {
    const eventId = await createEvent(150, 'theatre');

    await expect(checkVenueSuitability(eventId, { venueId: hallId }, otherCoordinatorId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('reports a venue that does not exist as not found', async () => {
    const eventId = await createEvent(150, 'theatre');

    await expect(
      checkVenueSuitability(eventId, { venueId: '99999999-9999-4999-8999-999999999999' }, coordinatorId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a check that names both a venue and a booking request, or neither', async () => {
    const eventId = await createEvent(150, 'theatre');
    const bookingRequestId = await createBookingRequest(eventId, hallId);

    await expect(checkVenueSuitability(eventId, {}, coordinatorId)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(checkVenueSuitability(eventId, { venueId: hallId, bookingRequestId }, coordinatorId)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});

describe('checkVenueSuitability for a booking request: SCRUM-136 AC5', () => {
  it("checks the request at its own venue, and says which request it was for", async () => {
    const eventId = await createEvent(150, 'theatre');
    const bookingRequestId = await createBookingRequest(eventId, hallId);

    const result = await checkVenueSuitability(eventId, { bookingRequestId }, coordinatorId);

    expect(result).toMatchObject({ bookingRequestId, venue: { id: hallId }, verdict: 'not_suitable' });
    expect(result.requirements[0]?.shortfall).toBe(30);
  });

  it("treats another event's booking request as not found", async () => {
    const otherEventId = await createEvent(80, 'theatre');
    const otherRequestId = await createBookingRequest(otherEventId, hallId);
    const eventId = await createEvent(150, 'theatre');

    await expect(checkVenueSuitability(eventId, { bookingRequestId: otherRequestId }, coordinatorId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('refuses a coordinator the event is not assigned to before reading the request', async () => {
    const eventId = await createEvent(150, 'theatre');
    const bookingRequestId = await createBookingRequest(eventId, hallId);

    await expect(checkVenueSuitability(eventId, { bookingRequestId }, otherCoordinatorId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
