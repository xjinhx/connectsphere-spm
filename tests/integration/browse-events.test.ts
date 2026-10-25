import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { listOpenEvents } from '@/domain/event-registration/service';
import { createVenue } from '@/domain/venues/service';
import { TEST_CLIENT_ORGANISATION_ID, ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-180 Browse open events and see my registrations (Jira, authoritative):
 *   AC1 an event whose registration period is open is listed with its name,
 *       date, start and end times and venue;
 *   AC2 an event whose period has not opened or has closed is not listed.
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
let locationId: string;
let ballroomId: string;
let seminarRoomId: string;
let trainingRoomId: string;
const eventIds: string[] = [];
const venueIds: string[] = [];

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
  const { data: user, error: userError } = await admin.auth.admin.createUser({
    email: `organiser+browse${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (userError || !user.user) throw new Error(`could not create test organiser: ${userError?.message}`);
  organiserId = user.user.id;

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
  if (organiserId) await admin.auth.admin.deleteUser(organiserId);
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
