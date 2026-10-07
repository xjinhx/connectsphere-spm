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
 * SCRUM-101 AC3/AC4 — raising a venue booking request moves the event's own
 * status, through the trigger in
 * 20261006100000_event_request_enter_planning_on_booking_request.sql. Goes
 * through submitVenueBookingRequest, not enterPlanning(): the point is that
 * the real request is what moves the event.
 */
describe('SCRUM-101 — a venue booking request moves the event to Planning', () => {
  const request = { venueId: '', lines: [{ date: '2026-11-15', timeSlots: ['pm'] }] };

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
      lines: [{ date: '2026-11-16', timeSlots: ['am'] }],
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
