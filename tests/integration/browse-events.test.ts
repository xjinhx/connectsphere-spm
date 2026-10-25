import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { getRegistrationPage, listOpenEvents } from '@/domain/event-registration/service';
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
 *       details.
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
  bookings?: { venueId: string; status: 'confirmed' | 'released' }[];
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
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test event: ${error?.message}`);
  eventIds.push(data.id);

  if (bookings.length > 0) {
    const { error: bookingError } = await admin.from('venue_booking').insert(
      bookings.map(({ venueId, status }) => ({
        venue_id: venueId,
        event_request_id: data.id,
        date,
        start_time: '18:00',
        end_time: '22:00',
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

    // Only the AC3 fields, plus SCRUM-181's registration state.
    expect(Object.keys(view).sort()).toEqual(
      ['description', 'eventDate', 'eventName', 'eventRequestId', 'period', 'periodRefusal', 'registration', 'times', 'venues'],
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
