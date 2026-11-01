import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { registerForEvent } from '@/domain/event-registration/service';
import { listNotifications } from '@/domain/notification/service';
import { NOTIFICATION_TYPES } from '@/domain/notification/schema';
import { createVenue } from '@/domain/venues/service';
import { TEST_CLIENT_ORGANISATION_ID, ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-201 Notify attendees about registration outcomes (Jira, authoritative):
 *   AC1 a registration that is created sends the attendee a confirmation with
 *       the event details;
 *   AC3 a registration refused because the event is full tells the attendee
 *       so (CL-73: the notification is the record of the refusal);
 *   AC4 a confirmed withdrawal sends the attendee a notification confirming it.
 * AC2 moved to SCRUM-186 (CL-34); AC5 is SCRUM-105 AC4 (CL-35). Not tested.
 *
 * Runs against the local Supabase stack: what is proved is the row that lands
 * in notifications, under the database's own type check, and the refusal
 * register_for_event finds with the event row locked. The clock is fixed at
 * 01/11/2026 10:00 Singapore time by passing `now`. Capacity 3 stands in for
 * the sheet's 20: the same boundary, fewer accounts to create.
 *
 * Test case IDs are from SCRUM-201-test-cases.xlsx (TC-201-nn).
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const NOW = new Date('2026-11-01T10:00:00+08:00');
const VALID = { fullName: 'Tan Mei Ling', email: 'attendee@example.com', contactNumber: '+65 9123 4567' };
const EVENT_NAME = `Client Appreciation Night ${RUN}`;
// Each case creates several accounts; the default 5 s is too tight on a cold local stack.
const TIMEOUT = 20_000;

let organiserId: string;
let locationId: string;
let venueId: string;
const userIds: string[] = [];
const eventIds: string[] = [];

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}${userIds.length}+notify${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  userIds.push(data.user.id);
  return data.user.id;
}

const createAttendee = () => createUser('attendee');

type EventOptions = {
  capacity?: number | null;
  /** The registration period; open on 01/11/2026 unless given. */
  start?: string;
  end?: string;
  /** A confirmed booking at the test venue, 19:00 to 22:00 on the event date. */
  booked?: boolean;
};

/** An event held on 17/11/2026, 19:00 to 22:00, with registration open 29/10/2026 to 06/11/2026 and 3 places. */
async function createEvent({ capacity = 3, start = '2026-10-29', end = '2026-11-06', booked = false }: EventOptions = {}) {
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: TEST_CLIENT_ORGANISATION_ID,
      name: EVENT_NAME,
      proposed_date: '2026-11-17',
      start_time: '19:00',
      end_time: '22:00',
      registration_start_date: start,
      registration_end_date: end,
      registration_capacity: capacity,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test event: ${error?.message}`);
  eventIds.push(data.id);

  if (booked) {
    const { error: bookingError } = await admin.from('venue_booking').insert({
      venue_id: venueId,
      event_request_id: data.id,
      date: '2026-11-17',
      start_time: '19:00',
      end_time: '22:00',
      status: 'confirmed',
    } as never);
    if (bookingError) throw new Error(`could not book test event: ${bookingError.message}`);
  }
  return data.id;
}

/** Registers `count` new attendees for the event; returns their ids. */
async function fill(eventId: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = await createAttendee();
    await registerForEvent(eventId, id, VALID, NOW);
    ids.push(id);
  }
  return ids;
}

/** The attendee's notifications about one event, newest first. */
async function notificationsFor(attendeeId: string, eventId: string) {
  return (await listNotifications(attendeeId)).filter((notification) => notification.eventRequestId === eventId);
}

const typesFor = async (attendeeId: string, eventId: string) =>
  (await notificationsFor(attendeeId, eventId)).map((notification) => notification.type);

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal');
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  organiserId = await createUser('organiser');

  const { data: location, error } = await admin.from('locations').insert({ name: `Notify Location ${RUN}` }).select('id').single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;
  const venue = await createVenue({
    name: `Marina Bay Ballroom ${RUN}`,
    locationId,
    maxCapacity: 200,
    operatingSlots: ['am', 'pm', 'night'],
  });
  venueId = venue.id;
});

afterAll(async () => {
  // Registrations, bookings and notifications go with their events (cascade), then the accounts can go.
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  if (venueId) await admin.from('venues').delete().eq('id', venueId);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
}, 60_000);

describe('the migration keeps every notification type already on main', () => {
  it('TC-201-01 every type in NOTIFICATION_TYPES, the 15 before SCRUM-201 and its 3, is accepted by notifications_type_known', async () => {
    const eventId = await createEvent();
    const recipient = await createAttendee();

    const { error } = await admin.from('notifications').insert(
      NOTIFICATION_TYPES.map((type) => ({ recipient_id: recipient, type, event_request_id: eventId, message: type })),
    );

    expect(error).toBeNull();
    expect(NOTIFICATION_TYPES).toHaveLength(18);
  });
});

describe('AC1: a registration that is created sends a confirmation with the event details', () => {
  it(
    'TC-201-01 the attendee gets one unread confirmation with the name, date, times, venue and their reference; nobody else does',
    async () => {
      const eventId = await createEvent({ booked: true });
      const [a, b] = [await createAttendee(), await createAttendee()];

      const registration = await registerForEvent(eventId, a, VALID, NOW);

      const sent = await notificationsFor(a, eventId);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        type: 'registration_confirmed',
        readAt: null,
        message: `You are registered for "${EVENT_NAME}" on 17/11/2026, 19:00–22:00 at Marina Bay Ballroom ${RUN}. Your reference is ${registration.reference}.`,
      });
      expect(await notificationsFor(b, eventId)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'TC-201-02 a second registration and one on a closed event are refused, and send no further confirmation',
    async () => {
      const eventId = await createEvent();
      const closedId = await createEvent({ start: '2026-10-22', end: '2026-10-31' });
      const a = await createAttendee();
      await registerForEvent(eventId, a, VALID, NOW);

      expect(await refusal(registerForEvent(eventId, a, VALID, NOW))).toMatchObject({ code: 'CONFLICT' });
      expect(await refusal(registerForEvent(closedId, a, VALID, NOW))).toMatchObject({
        message: 'Registration closed on 31/10/2026.',
      });

      expect(await typesFor(a, eventId)).toEqual(['registration_confirmed']);
      expect(await typesFor(a, closedId)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'TC-201-03 taking the last place (3 of 3) is confirmed, and not told the event is full',
    async () => {
      const eventId = await createEvent({ capacity: 3 });
      await fill(eventId, 2);
      const a = await createAttendee();

      const registration = await registerForEvent(eventId, a, VALID, NOW);

      expect(registration.status).toBe('registered');
      expect(await typesFor(a, eventId)).toEqual(['registration_confirmed']);
    },
    TIMEOUT,
  );
});
