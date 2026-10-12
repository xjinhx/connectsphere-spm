import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createVenue, searchVenues } from '@/domain/venues/service';
import { listAffectedBookings } from '@/domain/availability/service';
import { getVenueCalendar } from '@/domain/venues/calendar';
import {
  decideVenueBookingRequest,
  listEventVenueBookings,
  releaseVenueBooking,
  submitVenueBookingRequest,
} from '@/domain/venue-booking/service';
import { ConflictError, ForbiddenError, ValidationError } from '@/domain/shared/errors';
import { todayInSingapore } from '@/domain/shared/dates';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-231 Release one venue booking without affecting the event's others
 * (Jira, authoritative): AC1 released with a reason and its time free again;
 * AC2 the event's other booking stays confirmed and the event is not
 * cancelled; AC3 a coordinator not assigned to the event is refused; AC4 an
 * affected booking's outstanding action closes.
 *
 * Bookings are made the real way: SCRUM-142's create_venue_booking_request,
 * then SCRUM-148's decision. Runs against the local Supabase stack.
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let locationId: string;
let venueStaffId: string;
let coordinatorId: string;
let otherCoordinatorId: string;
let organiserId: string;
const venueIds: string[] = [];
const eventIds: string[] = [];

function daysFromToday(days: number): string {
  const date = new Date(`${todayInSingapore()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+release${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  return data.user.id;
}

async function createTestVenue(label: string): Promise<string> {
  const venue = await createVenue({ name: `${label} ${RUN}`, locationId, maxCapacity: 200 });
  venueIds.push(venue.id);
  return venue.id;
}

/** An Approved event assigned to `coordinator`. */
async function createEvent(date: string, coordinator = coordinatorId): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({ organiser_id: organiserId, client_organisation_id: CLIENT_ORGANISATION_ID, name: `Release Event ${RUN}`, proposed_date: date })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test event: ${error?.message}`);
  eventIds.push(data.id);
  const steps = [
    { status: 'submitted' },
    { coordinator_id: coordinator, assigned_by: coordinator },
    { status: 'approved', decision: 'approved', decided_by: coordinator },
  ];
  for (const patch of steps) {
    const { error: stepError } = await admin.from('event_request').update(patch).eq('id', data.id);
    if (stepError) throw new Error(`could not prepare test event: ${stepError.message}`);
  }
  return data.id;
}

/** Requests `slot` at the venue for the event, and Venue Staff approve it. Returns the booking's id. */
async function book(eventId: string, venueId: string, date: string, slot: string, coordinator = coordinatorId): Promise<string> {
  const { data: requestId, error } = await admin.rpc('create_venue_booking_request', {
    p_event_request_id: eventId,
    p_venue_id: venueId,
    p_requested_by: coordinator,
    p_lines: [{ date, time_slots: [slot] }],
  });
  if (error || !requestId) throw new Error(`could not create test request: ${error?.message}`);
  const { data: line } = await admin.from('venue_booking_request_line').select('id').eq('request_id', requestId).single();
  await decideVenueBookingRequest(requestId as string, venueStaffId, { decisions: [{ lineId: line!.id, decision: 'approve' }] });
  const { data: booking } = await admin
    .from('venue_booking')
    .select('id')
    .eq('event_request_id', eventId)
    .eq('venue_id', venueId)
    .eq('date', date)
    .eq('slot', slot)
    .single();
  return booking!.id;
}

async function bookingRow(id: string) {
  const { data } = await admin
    .from('venue_booking')
    .select('status, release_reason, released_by, released_at')
    .eq('id', id)
    .single();
  return data!;
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  const { data: location, error } = await admin.from('locations').insert({ name: `Release Location ${RUN}` }).select('id').single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;
  venueStaffId = await createUser('venue-staff');
  coordinatorId = await createUser('coordinator');
  otherCoordinatorId = await createUser('other-coordinator');
  organiserId = await createUser('organiser');
});

afterAll(async () => {
  // Events first: their requests, lines and bookings go with them (cascade).
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of venueIds) await admin.from('venues').delete().eq('id', id);
  for (const id of [venueStaffId, coordinatorId, otherCoordinatorId, organiserId]) if (id) await admin.auth.admin.deleteUser(id);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
});

describe('releaseVenueBooking (SCRUM-231)', () => {
  it('AC1: releases one of two bookings with a reason, recording who and when (TC-231-01)', async () => {
    const date = daysFromToday(20);
    const eventId = await createEvent(date);
    const bugis = await book(eventId, await createTestVenue('Bugis'), date, 'am');
    await book(eventId, await createTestVenue('Marina'), date, 'pm');

    await releaseVenueBooking(bugis, coordinatorId, { reason: '  Breakout moved to Marina  ' });

    expect(await bookingRow(bugis)).toMatchObject({
      status: 'released',
      release_reason: 'Breakout moved to Marina',
      released_by: coordinatorId,
    });
    expect((await bookingRow(bugis)).released_at).not.toBeNull();
  });

  it('AC1: the released time shows free in time-based search and on the calendar (TC-231-02)', async () => {
    const date = daysFromToday(30);
    const venueId = await createTestVenue('Searchable');
    const booking = await book(await createEvent(date), venueId, date, 'am');
    const found = async () => (await searchVenues({ date, start: '07:00', end: '12:00' })).venues.map((v) => v.id);
    const periods = async () =>
      (await getVenueCalendar(venueId, { from: date, to: date }, { userId: coordinatorId, roles: ['coordinator'] })).days[0]!.periods.map(
        (p) => `${p.start}-${p.end} ${p.kind}`,
      );
    expect(await found()).not.toContain(venueId);
    expect(await periods()).toContain('07:00-12:00 confirmed');

    await releaseVenueBooking(booking, coordinatorId, { reason: 'No longer needed' });

    expect(await found()).toContain(venueId);
    expect(await periods()).toEqual([]);
  });

  it('AC1: the released time is free again: another event can request it and be approved (TC-231-03)', async () => {
    const date = daysFromToday(21);
    const venueId = await createTestVenue('Freed');
    const booking = await book(await createEvent(date), venueId, date, 'am');
    const otherEvent = await createEvent(date, otherCoordinatorId);
    const request = { venueId, lines: [{ date, timeSlots: ['am'] }] };

    // Before the release, SCRUM-154 refuses the request: the slot is committed.
    await expect(submitVenueBookingRequest(otherEvent, otherCoordinatorId, request)).rejects.toThrow(ConflictError);

    await releaseVenueBooking(booking, coordinatorId, { reason: 'No longer needed' });
    const created = await submitVenueBookingRequest(otherEvent, otherCoordinatorId, request);
    await decideVenueBookingRequest(created.id, venueStaffId, { decisions: [{ lineId: created.lines[0]!.id, decision: 'approve' }] });

    const { data: confirmed } = await admin
      .from('venue_booking')
      .select('status')
      .eq('event_request_id', otherEvent)
      .eq('venue_id', venueId)
      .single();
    expect(confirmed!.status).toBe('confirmed');
  });

  it("AC2: the event's other booking stays confirmed and the event's status is unchanged (TC-231-06)", async () => {
    const date = daysFromToday(22);
    const eventId = await createEvent(date);
    const first = await book(eventId, await createTestVenue('First'), date, 'am');
    const second = await book(eventId, await createTestVenue('Second'), date, 'pm');
    const { data: before } = await admin.from('event_request').select('status').eq('id', eventId).single();

    await releaseVenueBooking(first, coordinatorId, { reason: 'Changing this space' });

    expect((await bookingRow(second)).status).toBe('confirmed');
    const { data: after } = await admin.from('event_request').select('status').eq('id', eventId).single();
    expect(after!.status).toBe(before!.status);
    expect(after!.status).not.toBe('cancelled');
  });

  it('AC2: releasing the only booking does not cancel the event (TC-231-07)', async () => {
    const date = daysFromToday(23);
    const eventId = await createEvent(date);
    const only = await book(eventId, await createTestVenue('Only'), date, 'am');
    const { data: before } = await admin.from('event_request').select('status').eq('id', eventId).single();

    await releaseVenueBooking(only, coordinatorId, { reason: 'No longer needed' });

    const { data: after } = await admin.from('event_request').select('status').eq('id', eventId).single();
    expect(after!.status).toBe(before!.status);
    expect(after!.status).not.toBe('cancelled');
  });

  it('AC1: refuses a release without a reason, and nothing changes (TC-231-04)', async () => {
    const date = daysFromToday(24);
    const booking = await book(await createEvent(date), await createTestVenue('Reasonless'), date, 'am');

    await expect(releaseVenueBooking(booking, coordinatorId, { reason: '   ' })).rejects.toThrow(ValidationError);
    expect((await bookingRow(booking)).status).toBe('confirmed');
  });

  it('AC3: refuses a coordinator the event is not assigned to, and nothing changes (TC-231-08)', async () => {
    const date = daysFromToday(25);
    const booking = await book(await createEvent(date), await createTestVenue('Guarded'), date, 'am');

    await expect(releaseVenueBooking(booking, otherCoordinatorId, { reason: 'Test' })).rejects.toThrow(ForbiddenError);
    expect((await bookingRow(booking)).status).toBe('confirmed');
  });

  it('refuses releasing a booking twice; the first reason is kept', async () => {
    const date = daysFromToday(26);
    const booking = await book(await createEvent(date), await createTestVenue('Twice'), date, 'am');
    await releaseVenueBooking(booking, coordinatorId, { reason: 'First' });

    await expect(releaseVenueBooking(booking, coordinatorId, { reason: 'Second' })).rejects.toThrow(ConflictError);
    expect((await bookingRow(booking)).release_reason).toBe('First');
  });

  it('AC4: releasing an affected booking closes its outstanding action (TC-231-09)', async () => {
    const date = daysFromToday(27);
    const venueId = await createTestVenue('Affected');
    const eventId = await createEvent(date);
    const booking = await book(eventId, venueId, date, 'am');
    await admin.from('venue_unavailable_slot').insert({ venue_id: venueId, date, slot: 'am', reason: 'Aircon repair' });
    expect(await listAffectedBookings(eventId)).toHaveLength(1);

    await releaseVenueBooking(booking, coordinatorId, { reason: 'Room unavailable, moving the session' });

    expect(await listAffectedBookings(eventId)).toEqual([]);
  });

  it('the database refuses a released booking with no reason', async () => {
    const date = daysFromToday(28);
    const booking = await book(await createEvent(date), await createTestVenue('Constraint'), date, 'am');

    const { error } = await admin
      .from('venue_booking')
      .update({ status: 'released', released_by: coordinatorId, released_at: new Date().toISOString() })
      .eq('id', booking);

    expect(error?.code).toBe('23514');
  });
});

describe('listEventVenueBookings (SCRUM-231 AC1-AC3)', () => {
  it("lists the event's bookings, released ones with their reason, and only its coordinator may release", async () => {
    const date = daysFromToday(29);
    const eventId = await createEvent(date);
    const kept = await book(eventId, await createTestVenue('Kept'), date, 'am');
    const released = await book(eventId, await createTestVenue('Given up'), date, 'pm');
    await releaseVenueBooking(released, coordinatorId, { reason: 'Changing this space' });

    const forCoordinator = await listEventVenueBookings(eventId, coordinatorId);
    expect(forCoordinator.map((b) => [b.id, b.status, b.startTime, b.endTime, b.releaseReason, b.canRelease])).toEqual([
      [kept, 'confirmed', '07:00', '12:00', null, true],
      [released, 'released', '13:00', '18:00', 'Changing this space', false],
    ]);

    const forOther = await listEventVenueBookings(eventId, otherCoordinatorId);
    expect(forOther.every((b) => !b.canRelease)).toBe(true);
  });
});
