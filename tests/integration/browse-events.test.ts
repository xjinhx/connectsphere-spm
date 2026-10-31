import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getRegistrationPage,
  listMyRegistrations,
  listOpenEvents,
  registerForEvent,
} from '@/domain/event-registration/service';
import { createVenue } from '@/domain/venues/service';
import { TEST_CLIENT_ORGANISATION_ID, ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-180 Browse open events and see my registrations (Jira, authoritative):
 *   AC1 an event whose registration period is open is listed with its name,
 *       date, start and end times and venue;
 *   AC2 an event whose period has not opened or has closed is not listed;
 *   AC3 an event opened from the list shows only its name, description, date,
 *       start and end times, venue name and address and registration period,
 *       not client, internal, booking, equipment, staff or other attendees'
 *       details;
 *   AC4 my registrations are listed with the event name, date, start and end
 *       times, venue and my registration status;
 *   AC5 a rescheduled event shows its new date and times against my
 *       registration;
 *   AC6 a cancelled event's registration is shown with the event marked
 *       Cancelled.
 *
 * Runs against the local Supabase stack. The clock is fixed by passing `now`.
 * Other tests' events may also be open on the fixed date, so each test looks
 * for its own events by id rather than at the whole list. Test case IDs are
 * from SCRUM-180-test-cases.xlsx (TC-180-nn).
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const NOW = new Date('2026-10-30T10:00:00+08:00');
const BALLROOM_ADDRESS = '10 Bayfront Avenue, Singapore 018956';

let organiserId: string;
let attendeeId: string;
let locationId: string;
let ballroomId: string;
let seminarRoomId: string;
let trainingRoomId: string;
const eventIds: string[] = [];
const venueIds: string[] = [];
const userIds: string[] = [];

/** A new account, with `fullName` on its profile when given. */
async function createUser(label: string, fullName?: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+browse${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  userIds.push(data.user.id);
  if (fullName) await admin.from('profiles').update({ full_name: fullName }).eq('id', data.user.id);
  return data.user.id;
}

async function createTestVenue(name: string, address: string | null): Promise<string> {
  const venue = await createVenue({ name: `${name} ${RUN}`, locationId, maxCapacity: 200, operatingSlots: ['am', 'pm', 'night'] });
  venueIds.push(venue.id);
  const { error } = await admin.from('venues').update({ address }).eq('id', venue.id);
  if (error) throw new Error(`could not set test venue address: ${error.message}`);
  return venue.id;
}

type EventOptions = {
  date?: string;
  start?: string | null;
  end?: string | null;
  /** Each booking runs 18:00 to 22:00 unless it gives its own times. */
  bookings?: { venueId: string; status: 'confirmed' | 'released'; start?: string; end?: string }[];
};

/**
 * A day of its own in December for each event, so two events' bookings at the
 * same venue never clash (venue_booking_no_overlap).
 */
function nextFreeDate(): string {
  return `2026-12-${String(eventIds.length + 1).padStart(2, '0')}`;
}

/**
 * An event from 18:00 to 22:00, with registration open 27/10/2026 to
 * 04/11/2026 and a confirmed booking at the ballroom that day, unless
 * `options` says otherwise.
 */
async function createEvent(name: string, options: EventOptions = {}): Promise<string> {
  const {
    date = nextFreeDate(),
    start = '2026-10-27',
    end = '2026-11-04',
    bookings = [{ venueId: ballroomId, status: 'confirmed' }],
  } = options;
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: TEST_CLIENT_ORGANISATION_ID,
      name: `${name} ${RUN}`,
      proposed_date: date,
      start_time: '18:00',
      end_time: '22:00',
      registration_start_date: start,
      registration_end_date: end,
      // SCRUM-182: no capacity counts as full, so registering needs one.
      registration_capacity: 50,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test event: ${error?.message}`);
  eventIds.push(data.id);

  if (bookings.length > 0) {
    const { error: bookingError } = await admin.from('venue_booking').insert(
      bookings.map(({ venueId, status, start: bookingStart = '18:00', end: bookingEnd = '22:00' }) => ({
        venue_id: venueId,
        event_request_id: data.id,
        date,
        start_time: bookingStart,
        end_time: bookingEnd,
        status,
        // A released booking always records why, who and when (SCRUM-231).
        ...(status === 'released'
          ? { release_reason: 'Replaced by a larger room', released_by: organiserId, released_at: new Date().toISOString() }
          : {}),
      })) as never,
    );
    if (bookingError) throw new Error(`could not book test event: ${bookingError.message}`);
  }
  return data.id;
}

async function listedIds(now: Date = NOW): Promise<string[]> {
  return (await listOpenEvents(now)).map((event) => event.eventRequestId);
}

/** Registers `attendee` through the app, as the event page does (SCRUM-181). */
async function register(eventId: string, attendee: string, fullName = 'Tan Mei Ling'): Promise<void> {
  await registerForEvent(eventId, attendee, { fullName, email: `${attendee}@example.com`, contactNumber: '+65 9123 4567' }, NOW);
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  organiserId = await createUser('organiser');
  attendeeId = await createUser('attendee', 'Tan Mei Ling');

  const { data: location, error } = await admin.from('locations').insert({ name: `Browse Location ${RUN}` }).select('id').single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;

  ballroomId = await createTestVenue('Marina Bay Ballroom', BALLROOM_ADDRESS);
  seminarRoomId = await createTestVenue('Bugis Seminar Room', '200 Victoria Street, Singapore 188021');
  trainingRoomId = await createTestVenue('Jurong East Training Room', null);
});

afterAll(async () => {
  // Bookings and registrations go with their events (cascade).
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of venueIds) await admin.from('venues').delete().eq('id', id);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
});

describe('AC1: an event whose registration period is open is listed', () => {
  it('TC-180-01 lists it with its name, date, start and end times and venue', async () => {
    const eventId = await createEvent('Client Appreciation Night', { date: '2026-11-15' });

    const listed = (await listOpenEvents(NOW)).find((event) => event.eventRequestId === eventId);

    expect(listed).toEqual({
      eventRequestId: eventId,
      eventName: `Client Appreciation Night ${RUN}`,
      eventDate: '2026-11-15',
      times: { start: '18:00', end: '22:00' },
      venues: [{ name: `Marina Bay Ballroom ${RUN}`, address: BALLROOM_ADDRESS }],
    });
  });

  it('TC-180-02 periods that start today or end today are listed (both dates inclusive)', async () => {
    const startsToday = await createEvent('Opens today', { start: '2026-10-30', end: '2026-11-04' });
    const endsToday = await createEvent('Closes today', { start: '2026-10-25', end: '2026-10-30' });

    expect(await listedIds()).toEqual(expect.arrayContaining([startsToday, endsToday]));
    // And at the other end of that Singapore day, still 30/10.
    expect(await listedIds(new Date('2026-10-30T23:45:00+08:00'))).toEqual(
      expect.arrayContaining([startsToday, endsToday]),
    );
  });

  it('TC-180-08 an event at two venues lists both; a released booking\'s venue is left out', async () => {
    const eventId = await createEvent('Product Launch Briefing', {
      bookings: [
        { venueId: ballroomId, status: 'confirmed' },
        { venueId: seminarRoomId, status: 'confirmed' },
        { venueId: trainingRoomId, status: 'released' },
      ],
    });

    const listed = (await listOpenEvents(NOW)).find((event) => event.eventRequestId === eventId);

    expect(listed?.venues.map((venue) => venue.name)).toEqual([
      `Bugis Seminar Room ${RUN}`,
      `Marina Bay Ballroom ${RUN}`,
    ]);
  });

  it('TC-180-17 a venue booked twice for the event (morning and afternoon) is listed once, on the list and the page', async () => {
    // Two bookings at one venue on one day: venue_booking_no_overlap allows them, since the times do not overlap.
    const eventId = await createEvent('Client Training Day', {
      bookings: [
        { venueId: ballroomId, status: 'confirmed', start: '09:00', end: '12:00' },
        { venueId: ballroomId, status: 'confirmed', start: '14:00', end: '17:00' },
      ],
    });

    const listed = (await listOpenEvents(NOW)).find((event) => event.eventRequestId === eventId);
    const page = await getRegistrationPage(eventId, attendeeId, NOW);

    expect(listed?.venues).toEqual([{ name: `Marina Bay Ballroom ${RUN}`, address: BALLROOM_ADDRESS }]);
    expect(page.venues).toEqual([{ name: `Marina Bay Ballroom ${RUN}`, address: BALLROOM_ADDRESS }]);
  });

  it('TC-180-16 a Cancelled or Completed event is not listed, even with its period open (PO, 28/10/2026)', async () => {
    const goingAhead = await createEvent('Client Appreciation Night');
    const cancelled = await createEvent('Year-End Gala');
    const completed = await createEvent('Annual Dinner');
    // Cancelling is SCRUM-102 / 177's and completing SCRUM-104's; this writes the status each sets.
    for (const [id, status] of [[cancelled, 'cancelled'], [completed, 'completed']] as const) {
      const { error } = await admin
        .from('event_request')
        .update({ status, submitted_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw new Error(`could not set test event to ${status}: ${error.message}`);
    }

    const listed = await listedIds();

    expect(listed).toContain(goingAhead);
    expect(listed).not.toContain(cancelled);
    expect(listed).not.toContain(completed);
  });
});

describe('AC2: an event whose period has not opened or has closed is not listed', () => {
  it('TC-180-03 a period starting tomorrow is not listed', async () => {
    const opensTomorrow = await createEvent('Opens tomorrow', { start: '2026-10-31', end: '2026-11-09' });

    expect(await listedIds()).not.toContain(opensTomorrow);
  });

  it('TC-180-04 a period that ended yesterday is not listed', async () => {
    const closedYesterday = await createEvent('Closed yesterday', { start: '2026-10-20', end: '2026-10-29' });

    expect(await listedIds()).not.toContain(closedYesterday);
  });

  it('TC-180-05 an event with no registration period is not listed', async () => {
    const noPeriod = await createEvent('Partner Networking Lunch', { start: null, end: null });

    expect(await listedIds()).not.toContain(noPeriod);
  });
});

describe('AC3: the event page shows only what an attendee may see', () => {
  it('TC-180-06 shows the name, description, date, times, venue name and address, and registration period', async () => {
    const eventId = await createEvent('Client Appreciation Night');
    await admin.from('event_request').update({ description: 'An evening to thank our clients.' }).eq('id', eventId);

    const view = await getRegistrationPage(eventId, attendeeId, NOW);

    expect(view).toMatchObject({
      eventName: `Client Appreciation Night ${RUN}`,
      description: 'An evening to thank our clients.',
      times: { start: '18:00', end: '22:00' },
      venues: [{ name: `Marina Bay Ballroom ${RUN}`, address: BALLROOM_ADDRESS }],
      period: { startDate: '2026-10-27', endDate: '2026-11-04' },
    });
    expect(view.eventDate).toMatch(/^2026-12-\d{2}$/);
  });

  it("TC-180-07 reads no client, internal comment, booking status, equipment, staff or other attendee's details", async () => {
    const eventId = await createEvent('Client Appreciation Night');
    const { data: client } = await admin
      .from('client_organisations')
      .select('name')
      .eq('id', TEST_CLIENT_ORGANISATION_ID)
      .single();
    const coordinator = await createUser('coordinator', `Coordinator A ${RUN}`);
    // Submitted, then assigned, as the app would; then the internal notes.
    for (const patch of [
      { status: 'submitted' as const, submitted_at: new Date().toISOString() },
      { coordinator_id: coordinator, assigned_by: coordinator },
      {
        clarification_note: `Check catering budget ${RUN}`,
        clarification_requested_by: coordinator,
        clarification_requested_at: new Date().toISOString(),
        technical_support_notes: `Wireless microphone ${RUN}`,
        equipment_required: true,
      },
    ]) {
      const { error } = await admin.from('event_request').update(patch).eq('id', eventId);
      if (error) throw new Error(`could not prepare test event: ${error.message}`);
    }
    const otherAttendee = await createUser('attendee2', `Lim Wei Jie ${RUN}`);
    await admin.from('event_registration').insert({
      event_request_id: eventId,
      attendee_id: otherAttendee,
      full_name: `Lim Wei Jie ${RUN}`,
      email: `attendee2+${RUN}@example.com`,
      contact_number: '+65 9000 0000',
    });

    const view = await getRegistrationPage(eventId, attendeeId, NOW);
    const shown = JSON.stringify(view);

    // Only the AC3 fields, plus SCRUM-181's registration state, SCRUM-182's
    // full flag (the capacity itself is not shown) and SCRUM-184's canWithdraw
    // (whether the viewer may withdraw their own registration).
    expect(Object.keys(view).sort()).toEqual(
      ['canWithdraw', 'description', 'eventDate', 'eventName', 'eventRequestId', 'full', 'period', 'periodRefusal', 'registration', 'times', 'venues'],
    );
    expect(view.venues).toEqual([{ name: `Marina Bay Ballroom ${RUN}`, address: BALLROOM_ADDRESS }]);
    for (const hidden of [
      client!.name,
      `Check catering budget ${RUN}`,
      `Wireless microphone ${RUN}`,
      `Coordinator A ${RUN}`,
      `Lim Wei Jie ${RUN}`,
      `attendee2+${RUN}@example.com`,
      'confirmed',
    ]) {
      expect(shown).not.toContain(hidden);
    }
    expect(view.registration).toBeNull();
  });

  it("TC-180-08 the page shows both confirmed venues with their addresses, not a released booking's venue", async () => {
    const eventId = await createEvent('Product Launch Briefing', {
      bookings: [
        { venueId: ballroomId, status: 'confirmed' },
        { venueId: seminarRoomId, status: 'confirmed' },
        { venueId: trainingRoomId, status: 'released' },
      ],
    });

    const view = await getRegistrationPage(eventId, attendeeId, NOW);

    expect(view.venues).toEqual([
      { name: `Bugis Seminar Room ${RUN}`, address: '200 Victoria Street, Singapore 188021' },
      { name: `Marina Bay Ballroom ${RUN}`, address: BALLROOM_ADDRESS },
    ]);
  });
});

describe('AC4: my registrations are listed with the event and my status', () => {
  it('TC-180-09 lists each with the event name, date, start and end times, venue and status Registered', async () => {
    const attendee = await createUser('attendee-09');
    const night = await createEvent('Client Appreciation Night', { date: '2026-11-20' });
    const briefing = await createEvent('Product Launch Briefing', {
      date: '2026-11-21',
      bookings: [{ venueId: seminarRoomId, status: 'confirmed' }],
    });
    await register(night, attendee);
    await register(briefing, attendee);

    const registrations = await listMyRegistrations(attendee);

    expect(registrations).toMatchObject([
      {
        eventRequestId: night,
        eventName: `Client Appreciation Night ${RUN}`,
        eventDate: '2026-11-20',
        times: { start: '18:00', end: '22:00' },
        venues: [{ name: `Marina Bay Ballroom ${RUN}` }],
        status: 'registered',
      },
      {
        eventRequestId: briefing,
        eventName: `Product Launch Briefing ${RUN}`,
        eventDate: '2026-11-21',
        venues: [{ name: `Bugis Seminar Room ${RUN}` }],
        status: 'registered',
      },
    ]);
  });

  it("TC-180-10 lists only my own registrations, never another attendee's", async () => {
    const attendee = await createUser('attendee-10');
    const otherAttendee = await createUser('attendee2-10');
    const night = await createEvent('Client Appreciation Night');
    const lunch = await createEvent('Partner Networking Lunch');
    await register(night, attendee);
    await register(night, otherAttendee, `Lim Wei Jie ${RUN}`);
    await register(lunch, otherAttendee, `Lim Wei Jie ${RUN}`);

    const registrations = await listMyRegistrations(attendee);

    expect(registrations.map((registration) => registration.eventRequestId)).toEqual([night]);
    expect(JSON.stringify(registrations)).not.toContain(`Lim Wei Jie ${RUN}`);
    expect(JSON.stringify(registrations)).not.toContain(otherAttendee);
  });

  it('TC-180-11 a withdrawn registration is listed as Withdrawn; an attendee with none gets an empty list', async () => {
    const attendee = await createUser('attendee-11');
    const night = await createEvent('Client Appreciation Night', { date: '2026-11-22' });
    const briefing = await createEvent('Product Launch Briefing', { date: '2026-11-23' });
    await register(night, attendee);
    await register(briefing, attendee);
    // Withdrawing is SCRUM-184's; nothing in the app sets it yet, so the status
    // is set here, as that story's withdrawal will write it.
    await admin
      .from('event_registration')
      .update({ status: 'withdrawn' })
      .eq('event_request_id', briefing)
      .eq('attendee_id', attendee);

    const statuses = (await listMyRegistrations(attendee)).map((registration) => registration.status);

    expect(statuses).toEqual(['registered', 'withdrawn']);
    expect(await listMyRegistrations(await createUser('attendee3-11'))).toEqual([]);
  });
});

/**
 * Moves the event, and its bookings with it. Rescheduling through the app is
 * the change request stories' (B6), not on main yet; this writes what a
 * reschedule changes, so the list's own reading of it is what is tested.
 */
async function reschedule(eventId: string, date: string, start: string, end: string): Promise<void> {
  const { error } = await admin
    .from('event_request')
    .update({ proposed_date: date, start_time: start, end_time: end })
    .eq('id', eventId);
  if (error) throw new Error(`could not reschedule test event: ${error.message}`);
  const { error: bookingError } = await admin
    .from('venue_booking')
    .update({ date, start_time: start, end_time: end })
    .eq('event_request_id', eventId);
  if (bookingError) throw new Error(`could not move test booking: ${bookingError.message}`);
}

describe('AC5: a rescheduled event shows its new date and times against my registration', () => {
  it('TC-180-12 shows the new date and start and end times, still Registered', async () => {
    const attendee = await createUser('attendee-12');
    const night = await createEvent('Client Appreciation Night', { date: '2026-11-24' });
    await register(night, attendee);

    await reschedule(night, '2026-11-29', '19:00', '23:00');
    const [registration] = await listMyRegistrations(attendee);

    expect(registration).toMatchObject({
      eventRequestId: night,
      eventDate: '2026-11-29',
      times: { start: '19:00', end: '23:00' },
      status: 'registered',
    });
  });

  it('TC-180-13 a change of one 15-minute step on the same date shows the new times', async () => {
    const attendee = await createUser('attendee-13');
    const night = await createEvent('Client Appreciation Night', { date: '2026-11-25' });
    await register(night, attendee);

    await reschedule(night, '2026-11-25', '18:15', '22:15');
    const [registration] = await listMyRegistrations(attendee);

    expect(registration).toMatchObject({ eventDate: '2026-11-25', times: { start: '18:15', end: '22:15' } });
  });
});

describe('AC6: a cancelled event is marked Cancelled against my registration', () => {
  it('TC-180-14 the registration stays listed, with the event marked cancelled; the others are not', async () => {
    const attendee = await createUser('attendee-14');
    const gala = await createEvent('Year-End Gala', { date: '2026-11-26' });
    const night = await createEvent('Client Appreciation Night', { date: '2026-11-27' });
    await register(gala, attendee);
    await register(night, attendee);

    // Cancelling is SCRUM-102 / 177's (B3); this writes the status that flow sets.
    const { error } = await admin
      .from('event_request')
      .update({ status: 'cancelled', submitted_at: new Date().toISOString() })
      .eq('id', gala);
    if (error) throw new Error(`could not cancel test event: ${error.message}`);

    const registrations = await listMyRegistrations(attendee);

    expect(registrations).toMatchObject([
      { eventRequestId: gala, status: 'registered', eventCancelled: true },
      { eventRequestId: night, status: 'registered', eventCancelled: false },
    ]);
  });
});
