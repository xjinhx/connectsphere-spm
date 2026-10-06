import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createVenue } from '@/domain/venues/service';
import { submitVenueBookingRequest } from '@/domain/venue-booking/service';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-142 — Submit a venue booking request for an event.
 *
 * Runs against the local Supabase stack (`npm run db:start`, migrations
 * applied). The unit tests in tests/unit/venue-booking-service.test.ts mock
 * the data layer; this file is what proves the rows really land in Postgres:
 * one request, every date/slot line on it, each line Pending, and nothing
 * written when the request is refused. The admin client only arranges and
 * reads rows - the code under test is submitVenueBookingRequest.
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let locationId: string;
let venueId: string;
let otherVenueId: string | undefined;
let organiserId: string;
let coordinatorId: string;
let otherCoordinatorId: string;
const requestIds: string[] = [];

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+vbr${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message}`);
  return data.user.id;
}

/** An event assigned to `coordinator`, moved to `status` the way the earlier stories would. */
async function createEvent(status: 'draft' | 'submitted' | 'approved' | 'rejected', coordinator: string | null) {
  const { data, error } = await admin
    .from('event_request')
    .insert({ organiser_id: organiserId, client_organisation_id: CLIENT_ORGANISATION_ID, name: `VBR Event ${RUN}` })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test event: ${error?.message}`);
  const id = data.id as string;
  requestIds.push(id);

  if (status !== 'draft') {
    const { error: submitError } = await admin.from('event_request').update({ status: 'submitted' }).eq('id', id);
    if (submitError) throw new Error(`could not submit test event: ${submitError.message}`);
  }
  if (coordinator) {
    const { error: assignError } = await admin
      .from('event_request')
      .update({ coordinator_id: coordinator, assigned_by: coordinator })
      .eq('id', id);
    if (assignError) throw new Error(`could not assign test event: ${assignError.message}`);
  }
  if (status === 'approved' || status === 'rejected') {
    const patch =
      status === 'approved'
        ? { status, decision: 'approved', decided_by: coordinator ?? coordinatorId }
        : { status, decision: 'rejected', decided_by: coordinator ?? coordinatorId, rejection_reason: 'test' };
    const { error: decideError } = await admin.from('event_request').update(patch).eq('id', id);
    if (decideError) throw new Error(`could not move test event to ${status}: ${decideError.message}`);
  }
  return id;
}

async function requestsFor(eventId: string) {
  const { data, error } = await admin
    .from('venue_booking_request')
    .select('id, venue_id, requested_by, venue_booking_request_line ( date, time_slots, status )')
    .eq('event_request_id', eventId);
  if (error || !data) throw new Error(`could not read requests: ${error?.message}`);
  return data;
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  const { data, error } = await admin.from('locations').insert({ name: `VBR Location ${RUN}` }).select('id').single();
  if (error || !data) throw new Error(`could not create test location: ${error?.message}`);
  locationId = data.id;
  venueId = (await createVenue({ name: `VBR Venue ${RUN}`, locationId, maxCapacity: 200 })).id;
  organiserId = await createUser('organiser');
  coordinatorId = await createUser('coordinator');
  otherCoordinatorId = await createUser('othercoordinator');
});

afterAll(async () => {
  // Events first: their requests and lines cascade with them, a venue with a
  // request cannot be deleted, and coordinator_id is ON DELETE RESTRICT.
  if (requestIds.length > 0) await admin.from('event_request').delete().in('id', requestIds);
  if (otherVenueId) await admin.from('venues').delete().eq('id', otherVenueId);
  if (venueId) await admin.from('venues').delete().eq('id', venueId);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
  for (const id of [organiserId, coordinatorId, otherCoordinatorId]) {
    if (id) await admin.auth.admin.deleteUser(id);
  }
});

describe('SCRUM-142 against a real database', () => {
  // SCRUM-142-TC01 (AC1)
  it('creates a Pending request for an Approved event, readable by the Venue Staff queue', async () => {
    const eventId = await createEvent('approved', coordinatorId);

    const outcome = await submitVenueBookingRequest(eventId, coordinatorId, {
      venueId,
      lines: [{ date: '2026-11-15', timeSlots: ['pm'] }],
    });

    const rows = await requestsFor(eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(outcome.id);
    expect(rows[0]?.venue_id).toBe(venueId);
    expect(rows[0]?.requested_by).toBe(coordinatorId);
    expect(rows[0]?.venue_booking_request_line).toEqual([
      { date: '2026-11-15', time_slots: ['pm'], status: 'pending' },
    ]);
  });

  // SCRUM-142-TC05 (AC3)
  it('carries two dates on ONE request, each line Pending', async () => {
    const eventId = await createEvent('approved', coordinatorId);

    await submitVenueBookingRequest(eventId, coordinatorId, {
      venueId,
      lines: [
        { date: '2026-11-15', timeSlots: ['pm'] },
        { date: '2026-11-16', timeSlots: ['am'] },
      ],
    });

    const rows = await requestsFor(eventId);
    expect(rows).toHaveLength(1);
    const lines = [...(rows[0]?.venue_booking_request_line ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    expect(lines).toEqual([
      { date: '2026-11-15', time_slots: ['pm'], status: 'pending' },
      { date: '2026-11-16', time_slots: ['am'], status: 'pending' },
    ]);
  });

  // SCRUM-142-TC06 (AC1, AC3)
  it('carries two slots on the same date', async () => {
    const eventId = await createEvent('approved', coordinatorId);

    await submitVenueBookingRequest(eventId, coordinatorId, {
      venueId,
      lines: [{ date: '2026-11-15', timeSlots: ['am', 'pm'] }],
    });

    const rows = await requestsFor(eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.venue_booking_request_line).toEqual([
      { date: '2026-11-15', time_slots: ['am', 'pm'], status: 'pending' },
    ]);
  });

  // SCRUM-142-TC03 / TC04 (AC2)
  it.each(['submitted', 'rejected'] as const)(
    'refuses an event that is %s and writes nothing',
    async (status) => {
      // A draft cannot hold a coordinator in the database
      // (event_request_assignment_needs_submission), so Draft is unit-tested only.
      const eventId = await createEvent(status, coordinatorId);

      await expect(
        submitVenueBookingRequest(eventId, coordinatorId, {
          venueId,
          lines: [{ date: '2026-11-15', timeSlots: ['pm'] }],
        }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: expect.stringMatching(/must be approved before venue arrangements/i),
      });
      expect(await requestsFor(eventId)).toHaveLength(0);
    },
  );

  // SCRUM-142-TC07 (AC4)
  it('refuses a coordinator the event is not assigned to and writes nothing', async () => {
    const eventId = await createEvent('approved', coordinatorId);

    await expect(
      submitVenueBookingRequest(eventId, otherCoordinatorId, {
        venueId,
        lines: [{ date: '2026-11-15', timeSlots: ['pm'] }],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await requestsFor(eventId)).toHaveLength(0);
  });

  // SCRUM-142-TC12 to TC16 (AC5)
  it('refuses an empty venue, date and slot together and writes nothing', async () => {
    const eventId = await createEvent('approved', coordinatorId);

    await expect(
      submitVenueBookingRequest(eventId, coordinatorId, { venueId: '', lines: [{ date: '   ', timeSlots: [] }] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await requestsFor(eventId)).toHaveLength(0);
  });
});

/**
 * SCRUM-154 — Block a booking request that clashes with a booking or an
 * unavailable slot. Test case IDs are the SCRUM-154 sheet's (TC-154-nn).
 *
 * The other event's confirmed bookings are written by hand, as SCRUM-148's
 * approval would write them, and the unavailable slots are stand-in D-09 rows
 * (SCRUM-151 writes them for real). Each test uses a date of its own, so the
 * shared venue's rows never touch another test.
 */
describe('SCRUM-154 against a real database', () => {
  /** A confirmed booking of `venue` for some other event, as an approval would leave it. */
  async function bookSlot(date: string, slot: 'am' | 'pm' | 'night', venue = venueId) {
    const otherEventId = await createEvent('approved', coordinatorId);
    const { error } = await admin
      .from('venue_booking')
      .insert({ venue_id: venue, event_request_id: otherEventId, date, slot });
    if (error) throw new Error(`could not book test slot: ${error.message}`);
  }

  /** D-09: Venue Staff have withdrawn this slot, with a reason. */
  async function markUnavailable(date: string, slot: 'am' | 'pm' | 'night') {
    const { error } = await admin
      .from('venue_unavailable_slot')
      .insert({ venue_id: venueId, date, slot, reason: 'Annual maintenance' });
    if (error) throw new Error(`could not record unavailable slot: ${error.message}`);
  }

  async function request(date: string, ...timeSlots: ('am' | 'pm' | 'night')[]) {
    const eventId = await createEvent('approved', coordinatorId);
    const outcome = submitVenueBookingRequest(eventId, coordinatorId, {
      venueId,
      lines: [{ date, timeSlots }],
    });
    return { eventId, outcome };
  }

  // TC-154-01, TC-154-02 (AC1)
  it('refuses a slot with a confirmed booking, names it committed and writes nothing', async () => {
    await bookSlot('2027-03-01', 'pm');

    const { eventId, outcome } = await request('2027-03-01', 'pm');

    const error = await outcome.catch((caught) => caught);
    expect(error).toMatchObject({ code: 'CONFLICT', message: expect.stringMatching(/PM already committed/) });
    expect(JSON.stringify({ message: error.message, details: error.details })).not.toMatch(/VBR Event/);
    expect(await requestsFor(eventId)).toHaveLength(0);
  });

  // TC-154-03, TC-154-04 (AC2)
  it.each([
    ['am', 'pm'],
    ['pm', 'am'],
  ] as const)('creates a request for the %s-booked venue in the %s slot', async (booked, asked) => {
    const date = booked === 'am' ? '2027-03-02' : '2027-03-12';
    await bookSlot(date, booked);

    const { eventId, outcome } = await request(date, asked);
    await outcome;

    expect(await requestsFor(eventId)).toHaveLength(1);
  });

  // TC-154-05 (AC3)
  it('refuses AM, PM and Night overall, naming PM as committed and the others as available', async () => {
    await bookSlot('2027-03-03', 'pm');

    const { eventId, outcome } = await request('2027-03-03', 'am', 'pm', 'night');

    await expect(outcome).rejects.toMatchObject({
      code: 'CONFLICT',
      details: {
        clashes: [{ date: '2027-03-03', committed: ['pm'], unavailable: [], available: ['am', 'night'] }],
      },
    });
    expect(await requestsFor(eventId)).toHaveLength(0);
  });

  // TC-154-07, TC-154-08 (AC4)
  it.each(['am', 'pm'] as const)('refuses a slot recorded as unavailable (%s) and writes nothing', async (slot) => {
    const date = slot === 'am' ? '2027-03-04' : '2027-03-05';
    await markUnavailable(date, slot);

    const { eventId, outcome } = await request(date, slot);

    await expect(outcome).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringMatching(/unavailable/) });
    expect(await requestsFor(eventId)).toHaveLength(0);
  });

  // TC-154-09 (AC4)
  it('refuses the whole request when one of its slots is unavailable', async () => {
    await markUnavailable('2027-03-06', 'am');

    const { eventId, outcome } = await request('2027-03-06', 'am', 'pm');

    await expect(outcome).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await requestsFor(eventId)).toHaveLength(0);
  });

  // TC-154-10, TC-154-11 (AC5)
  it.each([[['pm']], [['pm', 'night']]] as const)('creates %j when only AM is unavailable', async (slots) => {
    const date = slots.length === 1 ? '2027-03-07' : '2027-03-08';
    await markUnavailable(date, 'am');

    const { eventId, outcome } = await request(date, ...slots);
    await outcome;

    const rows = await requestsFor(eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.venue_booking_request_line[0]?.time_slots).toEqual(slots);
  });

  // TC-154-12, TC-154-14 (supplementary)
  it('does not hold a booked or unavailable slot against the same slot on another date', async () => {
    await bookSlot('2027-03-09', 'pm');
    await markUnavailable('2027-03-09', 'am');

    for (const [date, slot] of [
      ['2027-03-10', 'pm'],
      ['2027-03-10', 'am'],
    ] as const) {
      const { eventId, outcome } = await request(date, slot);
      await outcome;
      expect(await requestsFor(eventId)).toHaveLength(1);
    }
  });

  // TC-154-13 (supplementary)
  it('does not hold another venue booked slot against this venue', async () => {
    otherVenueId = (await createVenue({ name: `VBR Other Venue ${RUN}`, locationId, maxCapacity: 200 })).id;
    await bookSlot('2027-03-11', 'pm', otherVenueId);

    const { eventId, outcome } = await request('2027-03-11', 'pm');
    await outcome;

    expect(await requestsFor(eventId)).toHaveLength(1);
  });
});
