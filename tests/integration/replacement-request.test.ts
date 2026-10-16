import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createVenue } from '@/domain/venues/service';
import { listAffectedBookings } from '@/domain/availability/service';
import { decideVenueBookingRequest, submitVenueBookingRequest } from '@/domain/venue-booking/service';
import { todayInSingapore } from '@/domain/shared/dates';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-229 Request a replacement venue for an affected booking (Jira,
 * authoritative). AC2: on a Confirmed event the replacement request is created
 * and the event is not cancelled. AC3: while it is pending, the affected
 * booking and the event are unchanged. AC4: once it is approved, the affected
 * booking is replaced and its outstanding action closes. PO decision (Arwen,
 * 12 Oct 2026): approving releases the affected booking (SCRUM-231's release);
 * a Confirmed event may request a venue only as a replacement.
 *
 * Runs against the local stack. Requests go through submitVenueBookingRequest
 * and are decided through decideVenueBookingRequest, as the app does; the
 * admin client only arranges and reads rows.
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let locationId: string;
let organiserId: string;
let coordinatorId: string;
let venueStaffId: string;
const venueIds: string[] = [];
const eventIds: string[] = [];

function daysFromToday(days: number): string {
  const date = new Date(`${todayInSingapore()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+replace${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message}`);
  return data.user.id;
}

async function createTestVenue(label: string): Promise<{ id: string; name: string }> {
  const venue = await createVenue({ name: `${label} ${RUN} ${venueIds.length}`, locationId, maxCapacity: 200 });
  venueIds.push(venue.id);
  return { id: venue.id, name: venue.name };
}

/** An event assigned to the coordinator, moved to `status` the way the earlier stories would. */
async function createEvent(status: 'planning' | 'confirmed'): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: CLIENT_ORGANISATION_ID,
      name: `Replacement Event ${RUN}`,
      proposed_date: daysFromToday(55),
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test event: ${error?.message}`);
  eventIds.push(data.id);
  const steps: Record<string, unknown>[] = [
    { status: 'submitted' },
    { coordinator_id: coordinatorId, assigned_by: coordinatorId },
    { status: 'approved', decision: 'approved', decided_by: coordinatorId },
    { status: 'planning' },
  ];
  if (status === 'confirmed') steps.push({ status: 'confirmed' });
  for (const patch of steps) {
    const { error: stepError } = await admin.from('event_request').update(patch).eq('id', data.id);
    if (stepError) throw new Error(`could not prepare test event: ${stepError.message}`);
  }
  return data.id;
}

async function confirmedBooking(eventId: string, venueId: string, date: string, start: string, end: string): Promise<string> {
  const { data, error } = await admin
    .from('venue_booking')
    .insert({ event_request_id: eventId, venue_id: venueId, date, start_time: start, end_time: end })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test booking: ${error?.message}`);
  return data.id;
}

/** Venue Staff mark a period unavailable (SCRUM-151 in times), which flags the bookings it overlaps. */
async function markUnavailable(venueId: string, date: string, start: string, end: string, reason: string) {
  const { error } = await admin
    .from('venue_unavailable_slot')
    .insert({ venue_id: venueId, date, start_time: start, end_time: end, reason });
  if (error) throw new Error(`could not mark test period unavailable: ${error.message}`);
}

async function bookingRow(id: string) {
  const { data, error } = await admin
    .from('venue_booking')
    .select('status, release_reason, released_by')
    .eq('id', id)
    .single();
  if (error || !data) throw new Error(`could not read booking: ${error?.message}`);
  return data;
}

async function eventStatus(id: string): Promise<string> {
  const { data, error } = await admin.from('event_request').select('status').eq('id', id).single();
  if (error || !data) throw new Error(`could not read event: ${error?.message}`);
  return data.status as string;
}

async function requestCount(eventId: string): Promise<number> {
  const { count, error } = await admin
    .from('venue_booking_request')
    .select('id', { count: 'exact', head: true })
    .eq('event_request_id', eventId);
  if (error) throw new Error(`could not count requests: ${error.message}`);
  return count ?? 0;
}

/**
 * TC-229's set-up: a Confirmed event with a booking at Bugis 10:15-11:45, and
 * Bugis marked unavailable 10:00-11:00 ("Ceiling leak"), so the booking is
 * affected.
 */
async function affectedEvent() {
  const eventId = await createEvent('confirmed');
  const [bugis, marina] = [await createTestVenue('Bugis'), await createTestVenue('Marina')];
  const date = daysFromToday(60);
  const bookingId = await confirmedBooking(eventId, bugis.id, date, '10:15', '11:45');
  await markUnavailable(bugis.id, date, '10:00', '11:00', 'Ceiling leak');
  return { eventId, bugis, marina, date, bookingId };
}

/** A pending replacement for the affected booking, at Marina, same date and times. */
async function requestReplacement(setup: Awaited<ReturnType<typeof affectedEvent>>) {
  return submitVenueBookingRequest(setup.eventId, coordinatorId, {
    venueId: setup.marina.id,
    lines: [{ date: setup.date, start: '10:15', end: '11:45' }],
    replacesBookingId: setup.bookingId,
  });
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  const { data, error } = await admin.from('locations').insert({ name: `Replace Location ${RUN}` }).select('id').single();
  if (error || !data) throw new Error(`could not create test location: ${error?.message}`);
  locationId = data.id;
  organiserId = await createUser('organiser');
  coordinatorId = await createUser('coordinator');
  venueStaffId = await createUser('venue-staff');
});

afterAll(async () => {
  // Events first: their requests, lines, bookings go with them (cascade).
  if (eventIds.length > 0) await admin.from('event_request').delete().in('id', eventIds);
  for (const id of venueIds) {
    await admin.from('venue_unavailable_slot').delete().eq('venue_id', id);
    await admin.from('venues').delete().eq('id', id);
  }
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
  for (const id of [organiserId, coordinatorId, venueStaffId]) if (id) await admin.auth.admin.deleteUser(id);
});

describe('submitting a replacement request (SCRUM-229 AC1, AC2)', () => {
  it('AC2: a Confirmed event can request a replacement; it is Pending and the event stays Confirmed (TC-229-02)', async () => {
    const setup = await affectedEvent();

    const outcome = await requestReplacement(setup);

    expect(outcome.lines.map((line) => [line.date, line.start, line.end, line.status])).toEqual([
      [setup.date, '10:15', '11:45', 'pending'],
    ]);
    const { data } = await admin.from('venue_booking_request').select('replaces_booking_id').eq('id', outcome.id).single();
    expect(data?.replaces_booking_id).toBe(setup.bookingId);
    expect(await eventStatus(setup.eventId)).toBe('confirmed');
  });

  it('AC2: a Confirmed event with no affected booking cannot request a venue, with or without a link (TC-229-03)', async () => {
    const eventId = await createEvent('confirmed');
    const [bugis, marina] = [await createTestVenue('Bugis Unaffected'), await createTestVenue('Marina Unaffected')];
    const date = daysFromToday(61);
    const bookingId = await confirmedBooking(eventId, bugis.id, date, '10:15', '11:45');
    const line = { date, start: '10:15', end: '11:45' };

    await expect(submitVenueBookingRequest(eventId, coordinatorId, { venueId: marina.id, lines: [line] })).rejects.toThrow(
      'The event must be approved before venue arrangements can begin.',
    );
    await expect(
      submitVenueBookingRequest(eventId, coordinatorId, { venueId: marina.id, lines: [line], replacesBookingId: bookingId }),
    ).rejects.toThrow('Only a confirmed booking of this event that is affected can be replaced.');
    expect(await requestCount(eventId)).toBe(0);
  });

  it("refuses to replace another event's affected booking", async () => {
    const setup = await affectedEvent();
    const otherEventId = await createEvent('planning');

    await expect(
      submitVenueBookingRequest(otherEventId, coordinatorId, {
        venueId: setup.marina.id,
        lines: [{ date: setup.date, start: '10:15', end: '11:45' }],
        replacesBookingId: setup.bookingId,
      }),
    ).rejects.toThrow('Only a confirmed booking of this event that is affected can be replaced.');
    expect(await requestCount(otherEventId)).toBe(0);
  });

  it("AC1: the affected booking's own venue is refused, naming the unavailable period (TC-229-08)", async () => {
    const setup = await affectedEvent();

    await expect(
      submitVenueBookingRequest(setup.eventId, coordinatorId, {
        venueId: setup.bugis.id,
        lines: [{ date: setup.date, start: '10:15', end: '11:45' }],
        replacesBookingId: setup.bookingId,
      }),
    ).rejects.toMatchObject({ details: { reason: 'period_clash' }, message: expect.stringContaining('10:00') });
    expect(await requestCount(setup.eventId)).toBe(0);
  });
});

describe('a pending replacement changes nothing (SCRUM-229 AC3)', () => {
  it('leaves the affected booking confirmed with its outstanding action, and the event Confirmed (TC-229-04)', async () => {
    const setup = await affectedEvent();

    await requestReplacement(setup);

    expect((await bookingRow(setup.bookingId)).status).toBe('confirmed');
    expect((await listAffectedBookings(setup.eventId)).map((booking) => booking.bookingId)).toEqual([setup.bookingId]);
    expect(await eventStatus(setup.eventId)).toBe('confirmed');
  });
});

describe('deciding the replacement (SCRUM-229 AC4)', () => {
  it('approving it releases the affected booking as replaced and closes its outstanding action (TC-229-05)', async () => {
    const setup = await affectedEvent();
    const replacement = await requestReplacement(setup);

    await decideVenueBookingRequest(replacement.id, venueStaffId, {
      decisions: [{ lineId: replacement.lines[0]!.id, decision: 'approve' }],
    });

    expect(await bookingRow(setup.bookingId)).toEqual({
      status: 'released',
      release_reason: `Replaced by ${setup.marina.name}`,
      released_by: coordinatorId,
    });
    expect(await listAffectedBookings(setup.eventId)).toEqual([]);
    const { data: newBooking } = await admin
      .from('venue_booking')
      .select('status, start_time, end_time')
      .eq('event_request_id', setup.eventId)
      .eq('venue_id', setup.marina.id)
      .single();
    expect(newBooking).toEqual({ status: 'confirmed', start_time: '10:15:00', end_time: '11:45:00' });
    expect(await eventStatus(setup.eventId)).toBe('confirmed');
  });

  it('rejecting it leaves the affected booking confirmed with its outstanding action (TC-229-06)', async () => {
    const setup = await affectedEvent();
    const replacement = await requestReplacement(setup);

    await decideVenueBookingRequest(replacement.id, venueStaffId, {
      decisions: [{ lineId: replacement.lines[0]!.id, decision: 'reject', reason: 'Ballroom closed that day' }],
    });

    expect((await bookingRow(setup.bookingId)).status).toBe('confirmed');
    expect((await listAffectedBookings(setup.eventId)).map((booking) => booking.bookingId)).toEqual([setup.bookingId]);
  });

  it("replacing one of two affected bookings closes only that one's action (TC-229-07)", async () => {
    const setup = await affectedEvent();
    const jurong = await createTestVenue('Jurong');
    const jurongBookingId = await confirmedBooking(setup.eventId, jurong.id, setup.date, '14:00', '16:00');
    await markUnavailable(jurong.id, setup.date, '15:00', '17:00', 'Power works');
    const replacement = await requestReplacement(setup);

    await decideVenueBookingRequest(replacement.id, venueStaffId, {
      decisions: [{ lineId: replacement.lines[0]!.id, decision: 'approve' }],
    });

    expect((await bookingRow(setup.bookingId)).status).toBe('released');
    expect((await bookingRow(jurongBookingId)).status).toBe('confirmed');
    expect((await listAffectedBookings(setup.eventId)).map((booking) => booking.bookingId)).toEqual([jurongBookingId]);
  });
});
