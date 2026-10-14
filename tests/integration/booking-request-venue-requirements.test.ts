import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createVenue } from '@/domain/venues/service';
import { getBookingRequestRequirements, submitVenueBookingRequest } from '@/domain/venue-booking/service';
import { todayInSingapore } from '@/domain/shared/dates';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-230 Give each venue booking its own attendance and requirements (Jira,
 * authoritative). AC1: "I can enter the expected attendance, layout and
 * accessibility needs for that space". AC2: left empty, "the event's own ...
 * are used". AC6: a breakout room can be requested for the same time as the
 * event's auditorium booking, "because each venue is checked on its own".
 *
 * Runs against the local stack. The code under test is
 * submitVenueBookingRequest; the admin client only arranges and reads rows.
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let locationId: string;
let ballroomId: string;
let meetingRoomId: string;
let organiserId: string;
let coordinatorId: string;
const eventIds: string[] = [];

function daysFromToday(days: number): string {
  const date = new Date(`${todayInSingapore()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+vreq${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message}`);
  return data.user.id;
}

/** An Approved event assigned to the coordinator: attendance 250, Theatre, accessibility needed. */
async function createEvent(): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: CLIENT_ORGANISATION_ID,
      name: `Requirements Event ${RUN}`,
      expected_attendance: 250,
      room_layout: 'theatre',
      accessibility_required: true,
      accessibility_notes: 'Wheelchair access',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test event: ${error?.message}`);
  eventIds.push(data.id);
  for (const patch of [
    { status: 'submitted' },
    { coordinator_id: coordinatorId, assigned_by: coordinatorId },
    { status: 'approved', decision: 'approved', decided_by: coordinatorId },
  ]) {
    const { error: stepError } = await admin.from('event_request').update(patch).eq('id', data.id);
    if (stepError) throw new Error(`could not prepare test event: ${stepError.message}`);
  }
  return data.id;
}

async function requestsFor(eventId: string) {
  const { data, error } = await admin
    .from('venue_booking_request')
    .select('venue_id, expected_attendance, room_layout, accessibility_required, accessibility_notes')
    .eq('event_request_id', eventId);
  if (error || !data) throw new Error(`could not read requests: ${error?.message}`);
  return data;
}

async function confirmedBooking(eventId: string, venueId: string, date: string) {
  const { error } = await admin
    .from('venue_booking')
    .insert({ event_request_id: eventId, venue_id: venueId, date, start_time: '10:00', end_time: '13:00', status: 'confirmed' });
  if (error) throw new Error(`could not create test booking: ${error.message}`);
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  const { data, error } = await admin.from('locations').insert({ name: `VReq Location ${RUN}` }).select('id').single();
  if (error || !data) throw new Error(`could not create test location: ${error?.message}`);
  locationId = data.id;
  ballroomId = (await createVenue({ name: `VReq Ballroom ${RUN}`, locationId, maxCapacity: 300 })).id;
  meetingRoomId = (await createVenue({ name: `VReq Meeting Room ${RUN}`, locationId, maxCapacity: 60 })).id;
  organiserId = await createUser('organiser');
  coordinatorId = await createUser('coordinator');
});

afterAll(async () => {
  // Events first: their requests, lines and bookings go with them (cascade).
  if (eventIds.length > 0) await admin.from('event_request').delete().in('id', eventIds);
  for (const id of [ballroomId, meetingRoomId]) if (id) await admin.from('venues').delete().eq('id', id);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
  for (const id of [organiserId, coordinatorId]) if (id) await admin.auth.admin.deleteUser(id);
});

describe("a request's own venue requirements (SCRUM-230)", () => {
  it('AC1: saves the attendance, layout and accessibility entered for the venue (TC-230-01)', async () => {
    const eventId = await createEvent();

    await submitVenueBookingRequest(eventId, coordinatorId, {
      venueId: meetingRoomId,
      lines: [{ date: daysFromToday(40), start: '10:00', end: '13:00' }],
      expectedAttendance: 40,
      roomLayout: 'classroom',
      accessibilityRequired: true,
      accessibilityNotes: 'Hearing loop',
    });

    expect(await requestsFor(eventId)).toEqual([
      {
        venue_id: meetingRoomId,
        expected_attendance: 40,
        room_layout: 'classroom',
        accessibility_required: true,
        accessibility_notes: 'Hearing loop',
      },
    ]);
  });

  it.each([
    ['an attendance of 0 (TC-230-02)', 0],
    ['an attendance that is not a whole number (TC-230-12)', 12.5],
  ])('AC1: refuses %s, names the field and creates nothing', async (_label, expectedAttendance) => {
    const eventId = await createEvent();

    await expect(
      submitVenueBookingRequest(eventId, coordinatorId, {
        venueId: meetingRoomId,
        lines: [{ date: daysFromToday(41), start: '10:00', end: '13:00' }],
        expectedAttendance,
      }),
    ).rejects.toMatchObject({
      details: { fieldErrors: { expectedAttendance: ['Expected attendance must be a positive whole number'] } },
    });
    expect(await requestsFor(eventId)).toEqual([]);
  });

  it("AC2: left empty, stores nothing of its own, so the event's are used (TC-230-03)", async () => {
    const eventId = await createEvent();

    await submitVenueBookingRequest(eventId, coordinatorId, {
      venueId: meetingRoomId,
      lines: [{ date: daysFromToday(42), start: '10:00', end: '13:00' }],
      expectedAttendance: '',
      roomLayout: '',
      accessibilityNotes: '',
    });

    expect(await requestsFor(eventId)).toEqual([
      {
        venue_id: meetingRoomId,
        expected_attendance: null,
        room_layout: null,
        accessibility_required: null,
        accessibility_notes: null,
      },
    ]);
  });

  it('AC1: the database itself refuses an attendance of 0 and notes without a "needed" answer', async () => {
    const eventId = await createEvent();
    const base = { event_request_id: eventId, venue_id: meetingRoomId, requested_by: coordinatorId };

    const zero = await admin.from('venue_booking_request').insert({ ...base, expected_attendance: 0 });
    const notesAlone = await admin
      .from('venue_booking_request')
      .insert({ ...base, accessibility_required: false, accessibility_notes: 'Hearing loop' });

    expect(zero.error?.code).toBe('23514');
    expect(notesAlone.error?.code).toBe('23514');
  });
});

describe('what Venue Staff see on each request (SCRUM-230 AC2, AC3)', () => {
  it('AC1: shows the venue requirements entered for it (TC-230-01)', async () => {
    const eventId = await createEvent();
    const { id } = await submitVenueBookingRequest(eventId, coordinatorId, {
      venueId: meetingRoomId,
      lines: [{ date: daysFromToday(45), start: '10:00', end: '13:00' }],
      expectedAttendance: 40,
      roomLayout: 'classroom',
      accessibilityRequired: true,
      accessibilityNotes: 'Hearing loop',
    });

    expect((await getBookingRequestRequirements(id)).venueRequirements).toEqual({
      expectedAttendance: { value: 40, fromEvent: false },
      roomLayout: { value: 'classroom', fromEvent: false },
      accessibility: { required: true, features: [], notes: 'Hearing loop', fromEvent: false },
    });
  });

  it("AC2: left empty, shows the event's, marked as the event's (TC-230-03)", async () => {
    const eventId = await createEvent();
    const { id } = await submitVenueBookingRequest(eventId, coordinatorId, {
      venueId: meetingRoomId,
      lines: [{ date: daysFromToday(46), start: '10:00', end: '13:00' }],
    });

    expect((await getBookingRequestRequirements(id)).venueRequirements).toEqual({
      expectedAttendance: { value: 250, fromEvent: true },
      roomLayout: { value: 'theatre', fromEvent: true },
      accessibility: { required: true, features: [], notes: 'Wheelchair access', fromEvent: true },
    });
  });

  it('AC3: two requests for one event each show their own attendance (TC-230-05)', async () => {
    const eventId = await createEvent();
    const date = daysFromToday(47);
    const ballroom = await submitVenueBookingRequest(eventId, coordinatorId, {
      venueId: ballroomId,
      lines: [{ date, start: '10:00', end: '13:00' }],
      expectedAttendance: 250,
    });
    const meetingRoom = await submitVenueBookingRequest(eventId, coordinatorId, {
      venueId: meetingRoomId,
      lines: [{ date, start: '10:00', end: '13:00' }],
      expectedAttendance: 40,
    });

    expect((await getBookingRequestRequirements(ballroom.id)).venueRequirements.expectedAttendance.value).toBe(250);
    expect((await getBookingRequestRequirements(meetingRoom.id)).venueRequirements.expectedAttendance.value).toBe(40);
  });
});

describe('each venue is checked on its own (SCRUM-230 AC6)', () => {
  it("creates a breakout room request for the same time as the event's auditorium booking (TC-230-09)", async () => {
    const eventId = await createEvent();
    const date = daysFromToday(43);
    await confirmedBooking(eventId, ballroomId, date);

    await submitVenueBookingRequest(eventId, coordinatorId, {
      venueId: meetingRoomId,
      lines: [{ date, start: '10:00', end: '13:00' }],
      expectedAttendance: 40,
    });

    expect((await requestsFor(eventId)).map((request) => request.venue_id)).toEqual([meetingRoomId]);
  });

  it("still refuses the same venue and time as the event's own booking, naming the period (TC-230-11)", async () => {
    const eventId = await createEvent();
    const date = daysFromToday(44);
    await confirmedBooking(eventId, ballroomId, date);

    await expect(
      submitVenueBookingRequest(eventId, coordinatorId, {
        venueId: ballroomId,
        lines: [{ date, start: '10:00', end: '13:00' }],
      }),
    ).rejects.toMatchObject({ details: { reason: 'period_clash' }, message: expect.stringContaining('10:00') });
    expect(await requestsFor(eventId)).toEqual([]);
  });
});
