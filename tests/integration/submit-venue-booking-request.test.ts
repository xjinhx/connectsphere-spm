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
 * one request, every date-and-time line on it, each line Pending, and nothing
 * written when the request is refused. Lines are a start and end time since
 * SCRUM-239 AC3. The admin client only arranges and
 * reads rows - the code under test is submitVenueBookingRequest.
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let locationId: string;
let venueId: string;
const otherVenueIds: string[] = [];
let retiredVenueId: string | undefined;
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
    .select('id, venue_id, requested_by, venue_booking_request_line ( date, start_time, end_time, time_slots, status )')
    .eq('event_request_id', eventId);
  if (error || !data) throw new Error(`could not read requests: ${error?.message}`);
  return data;
}

async function statusOf(eventId: string): Promise<string> {
  const { data, error } = await admin.from('event_request').select('status').eq('id', eventId).single();
  if (error || !data) throw new Error(`could not read event status: ${error?.message}`);
  return data.status as string;
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
  if (otherVenueIds.length > 0) await admin.from('venues').delete().in('id', otherVenueIds);
  if (retiredVenueId) await admin.from('venues').delete().eq('id', retiredVenueId);
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
      lines: [{ date: '2026-11-15', start: '13:00', end: '18:00' }],
    });

    const rows = await requestsFor(eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(outcome.id);
    expect(rows[0]?.venue_id).toBe(venueId);
    expect(rows[0]?.requested_by).toBe(coordinatorId);
    // SCRUM-239 AC3: the line is the period asked for, with no slots.
    expect(rows[0]?.venue_booking_request_line).toEqual([
      { date: '2026-11-15', start_time: '13:00:00', end_time: '18:00:00', time_slots: null, status: 'pending' },
    ]);
  });

  // SCRUM-142-TC05 (AC3)
  it('carries two dates on ONE request, each line Pending', async () => {
    const eventId = await createEvent('approved', coordinatorId);

    await submitVenueBookingRequest(eventId, coordinatorId, {
      venueId,
      lines: [
        { date: '2026-11-15', start: '13:00', end: '18:00' },
        { date: '2026-11-16', start: '09:00', end: '11:00' },
      ],
    });

    const rows = await requestsFor(eventId);
    expect(rows).toHaveLength(1);
    const lines = [...(rows[0]?.venue_booking_request_line ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    expect(lines).toEqual([
      { date: '2026-11-15', start_time: '13:00:00', end_time: '18:00:00', time_slots: null, status: 'pending' },
      { date: '2026-11-16', start_time: '09:00:00', end_time: '11:00:00', time_slots: null, status: 'pending' },
    ]);
  });

  // SCRUM-142-TC06 (AC1, AC3), in times: two periods on the same date.
  it('carries two periods on the same date as two lines of one request', async () => {
    const eventId = await createEvent('approved', coordinatorId);

    await submitVenueBookingRequest(eventId, coordinatorId, {
      venueId,
      lines: [
        { date: '2026-11-15', start: '09:00', end: '11:00' },
        { date: '2026-11-15', start: '14:00', end: '16:00' },
      ],
    });

    const rows = await requestsFor(eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.venue_booking_request_line.map((line) => line.start_time).sort()).toEqual(['09:00:00', '14:00:00']);
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
          lines: [{ date: '2026-11-15', start: '13:00', end: '18:00' }],
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
        lines: [{ date: '2026-11-15', start: '13:00', end: '18:00' }],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await requestsFor(eventId)).toHaveLength(0);
  });

  // TC-142-10 (supplementary): before this check the request was created and
  // the event moved to Planning.
  it('refuses a retired venue, writes nothing and leaves the event Approved', async () => {
    retiredVenueId = (await createVenue({ name: `VBR Retired Venue ${RUN}`, locationId, maxCapacity: 200 })).id;
    const { error: retireError } = await admin.from('venues').update({ is_retired: true }).eq('id', retiredVenueId);
    if (retireError) throw new Error(`could not retire test venue: ${retireError.message}`);
    const eventId = await createEvent('approved', coordinatorId);

    await expect(
      submitVenueBookingRequest(eventId, coordinatorId, {
        venueId: retiredVenueId,
        lines: [{ date: '2026-11-15', start: '13:00', end: '18:00' }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringMatching(/retired/i) });
    expect(await requestsFor(eventId)).toHaveLength(0);
    expect(await statusOf(eventId)).toBe('approved');
  });

  // SCRUM-142-TC12 to TC16 (AC5)
  it('refuses an empty venue, date and times together and writes nothing', async () => {
    const eventId = await createEvent('approved', coordinatorId);

    await expect(
      submitVenueBookingRequest(eventId, coordinatorId, { venueId: '', lines: [{ date: '   ', start: '', end: '' }] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await requestsFor(eventId)).toHaveLength(0);
  });
});

/**
 * SCRUM-239 Part 3/4 — the booking request in exact times (Jira,
 * authoritative), against real rows:
 * AC1 (request part): a request outside the venue's opening hours is refused.
 * AC3: a request overlapping a confirmed booking is refused, naming the
 *      clashing period without any other event's details.
 * AC7 (request part): a booking made under the slot model still clashes.
 * AC8 (request half): a request overlapping an unavailable period is refused.
 * SCRUM-227 AC5: the event's own hold does not block its own request.
 *
 * SCRUM-154's rules carry over in time ranges (SCRUM-154 stays Done on slots)
 * and are kept as regressions (TC-154-nn). The other event's confirmed
 * bookings are written by hand, as an approval would leave them. Each test
 * uses a date of its own, so the shared venue's rows never touch another test.
 * Test case IDs are from ConnectSphere_TestCases_Sprint3_238_239_226.xlsx.
 */
describe('SCRUM-239 request in exact times, against a real database', () => {
  /** A confirmed booking of `venue` for some other event; a slot alone gets that slot's times (AC7). */
  async function book(date: string, period: { start?: string; end?: string; slot?: 'am' | 'pm' | 'night' }, venue = venueId) {
    const otherEventId = await createEvent('approved', coordinatorId);
    const { error } = await admin.from('venue_booking').insert({
      venue_id: venue,
      event_request_id: otherEventId,
      date,
      slot: period.slot ?? null,
      ...(period.start && period.end ? { start_time: period.start, end_time: period.end } : {}),
    } as never);
    if (error) throw new Error(`could not book test period: ${error.message}`);
    return otherEventId;
  }

  /** Venue Staff have withdrawn this period, with a reason. */
  async function markUnavailable(date: string, start: string, end: string) {
    const { error } = await admin
      .from('venue_unavailable_slot')
      .insert({ venue_id: venueId, date, slot: 'pm', start_time: start, end_time: end, reason: 'Ceiling repair' });
    if (error) throw new Error(`could not record unavailable period: ${error.message}`);
  }

  async function request(date: string, start: string, end: string, venue = venueId) {
    const eventId = await createEvent('approved', coordinatorId);
    const outcome = submitVenueBookingRequest(eventId, coordinatorId, { venueId: venue, lines: [{ date, start, end }] });
    return { eventId, outcome };
  }

  // TC-239-08, TC-239-09 (AC3)
  it('TC-239-08 / 09: refuses 11:00-13:00 against a booking 10:00-12:00, names 10:00-12:00 only, and writes nothing', async () => {
    const otherEventId = await book('2027-03-01', { start: '10:00', end: '12:00', slot: 'am' });

    const { eventId, outcome } = await request('2027-03-01', '11:00', '13:00');

    const error = await outcome.catch((caught) => caught);
    expect(error).toMatchObject({
      code: 'CONFLICT',
      message: 'This venue cannot be requested for that time. 1 Mar 2027 11:00–13:00 clashes with 10:00–12:00, which is already committed.',
    });
    const shown = JSON.stringify({ message: error.message, details: error.details });
    expect(shown).not.toContain(otherEventId);
    expect(shown).not.toMatch(/VBR Event/);
    expect(await requestsFor(eventId)).toHaveLength(0);
  });

  // TC-239-18 (AC3)
  it('TC-239-18: refuses the smallest overlap, 11:45-13:00', async () => {
    await book('2027-03-02', { start: '10:00', end: '12:00', slot: 'am' });

    const { eventId, outcome } = await request('2027-03-02', '11:45', '13:00');

    await expect(outcome).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await requestsFor(eventId)).toHaveLength(0);
  });

  it('creates 12:00-14:00, starting as the booking 10:00-12:00 ends', async () => {
    await book('2027-03-03', { start: '10:00', end: '12:00', slot: 'am' });

    const { eventId, outcome } = await request('2027-03-03', '12:00', '14:00');
    await outcome;

    expect(await requestsFor(eventId)).toHaveLength(1);
  });

  // TC-239-16 (AC7)
  it('TC-239-16: refuses 11:00-12:30 against an AM booking made under the slot model, naming 07:00-12:00', async () => {
    await book('2027-03-04', { slot: 'am' });

    const { outcome } = await request('2027-03-04', '11:00', '12:30');

    await expect(outcome).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringMatching(/clashes with 07:00–12:00/) });
  });

  // TC-239-25, TC-239-26 (AC8)
  it('TC-239-25 / 26: refuses 15:00-16:00 against unavailable 14:00-16:30, and creates 16:30-18:00', async () => {
    await markUnavailable('2027-03-05', '14:00', '16:30');

    const refused = await request('2027-03-05', '15:00', '16:00');
    const error = await refused.outcome.catch((caught) => caught);
    expect(error).toMatchObject({ code: 'CONFLICT', message: expect.stringMatching(/clashes with 14:00–16:30/) });
    expect(JSON.stringify(error.details)).not.toMatch(/Ceiling repair/);
    expect(await requestsFor(refused.eventId)).toHaveLength(0);

    const accepted = await request('2027-03-05', '16:30', '18:00');
    await accepted.outcome;
    expect(await requestsFor(accepted.eventId)).toHaveLength(1);
  });

  // TC-239-03, TC-239-17 (AC1)
  it('TC-239-03 / 17: refuses a period outside the opening hours, and creates one exactly matching them', async () => {
    const venue = (await createVenue({ name: `VBR Day Venue ${RUN}`, locationId, maxCapacity: 200, operatingSlots: ['am', 'pm'] })).id;
    otherVenueIds.push(venue);

    const early = await request('2027-03-06', '06:00', '08:00', venue);
    await expect(early.outcome).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: "This venue cannot be requested for that time. Outside this venue's opening hours (07:00–18:00).",
    });
    expect(await requestsFor(early.eventId)).toHaveLength(0);

    const late = await request('2027-03-06', '17:45', '18:15', venue);
    await expect(late.outcome).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const exact = await request('2027-03-06', '07:00', '18:00', venue);
    await exact.outcome;
    expect(await requestsFor(exact.eventId)).toHaveLength(1);
  });

  // SCRUM-227 AC5
  it("creates a request over a period held for the requesting event, but not one held for another (SCRUM-227 AC3, AC5)", async () => {
    const heldFor = await createEvent('approved', coordinatorId);
    const { error } = await admin.from('venue_hold').insert({
      venue_id: venueId,
      event_request_id: heldFor,
      date: '2027-03-07',
      start_time: '10:00',
      end_time: '12:00',
      expires_at: new Date(Date.now() + 72 * 3_600_000).toISOString(),
      created_by: coordinatorId,
    });
    if (error) throw new Error(`could not hold test period: ${error.message}`);

    await submitVenueBookingRequest(heldFor, coordinatorId, { venueId, lines: [{ date: '2027-03-07', start: '10:00', end: '12:00' }] });
    expect(await requestsFor(heldFor)).toHaveLength(1);

    const other = await request('2027-03-07', '11:00', '12:00');
    await expect(other.outcome).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringMatching(/clashes with 10:00–12:00/) });
  });

  // TC-154-03, TC-154-04 (SCRUM-154 AC2 in times)
  it('TC-154-03: creates a PM-time request when only the morning is booked', async () => {
    await book('2027-03-08', { slot: 'am' });

    const { eventId, outcome } = await request('2027-03-08', '13:00', '18:00');
    await outcome;

    expect(await requestsFor(eventId)).toHaveLength(1);
  });

  // TC-154-12, TC-154-14
  it('TC-154-12 / 14: does not hold a booked or unavailable period against the same time on another date', async () => {
    await book('2027-03-09', { start: '13:00', end: '18:00', slot: 'pm' });
    await markUnavailable('2027-03-09', '08:00', '10:00');

    for (const [start, end] of [
      ['13:00', '18:00'],
      ['08:00', '10:00'],
    ] as const) {
      const { eventId, outcome } = await request('2027-03-10', start, end);
      await outcome;
      expect(await requestsFor(eventId)).toHaveLength(1);
    }
  });

  // TC-154-13
  it("TC-154-13: does not hold another venue's booking against this venue", async () => {
    const other = (await createVenue({ name: `VBR Other Venue ${RUN}`, locationId, maxCapacity: 200 })).id;
    otherVenueIds.push(other);
    await book('2027-03-11', { start: '13:00', end: '18:00', slot: 'pm' }, other);

    const { eventId, outcome } = await request('2027-03-11', '13:00', '18:00');
    await outcome;

    expect(await requestsFor(eventId)).toHaveLength(1);
  });
});

/**
 * SCRUM-101 AC3/AC4 — raising a venue booking request moves the event's own
 * status, through the trigger in
 * 20261006100000_event_request_enter_planning_on_booking_request.sql. Goes
 * through submitVenueBookingRequest, not enterPlanning(): the point is that
 * the real request is what moves the event.
 */
describe('SCRUM-101 — a venue booking request moves the event to Planning', () => {
  const request = { venueId: '', lines: [{ date: '2026-11-15', start: '13:00', end: '18:00' }] };

  // AC3
  it('moves an Approved event to Planning on its first request', async () => {
    const eventId = await createEvent('approved', coordinatorId);

    await submitVenueBookingRequest(eventId, coordinatorId, { ...request, venueId });

    expect(await statusOf(eventId)).toBe('planning');
  });

  // AC4
  it('leaves an event already in Planning in Planning when a further request is raised', async () => {
    const eventId = await createEvent('approved', coordinatorId);
    await submitVenueBookingRequest(eventId, coordinatorId, { ...request, venueId });

    await submitVenueBookingRequest(eventId, coordinatorId, {
      venueId,
      lines: [{ date: '2026-11-16', start: '09:00', end: '11:00' }],
    });

    expect(await statusOf(eventId)).toBe('planning');
    expect(await requestsFor(eventId)).toHaveLength(2);
  });

  // A refused request writes nothing, so it must not move the event either.
  it('leaves the event Approved when the request is refused', async () => {
    const eventId = await createEvent('approved', coordinatorId);

    await expect(
      submitVenueBookingRequest(eventId, otherCoordinatorId, { ...request, venueId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(await statusOf(eventId)).toBe('approved');
  });
});
