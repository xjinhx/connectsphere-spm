import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { getRegistrationPage, registerForEvent, withdrawRegistration } from '@/domain/event-registration/service';
import { EVENT_TAKEN_PLACE, NO_PLACES_REMAINING } from '@/domain/event-registration/policy';
import { listNotifications } from '@/domain/notification/service';
import { NOTIFICATION_TYPES } from '@/domain/notification/schema';
import { CapacityExceededError, DomainError, NotFoundError } from '@/domain/shared/errors';
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
 * Test case IDs are from the ConnectSphere_TestCases_Sprint4 workbook,
 * SCRUM-201 tab (TC-201-nn).
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

async function registeredRows(eventId: string) {
  const { data, error } = await admin
    .from('event_registration')
    .select('attendee_id, status')
    .eq('event_request_id', eventId)
    .eq('status', 'registered');
  if (error) throw new Error(error.message);
  return data;
}

/** SCRUM-184's withdrawal, as the Withdraw button sends it once confirmed. */
const withdraw = (eventId: string, registrationId: string, attendeeId: string, now: Date = NOW) =>
  withdrawRegistration(eventId, registrationId, attendeeId, now);

const withdrawnCount = async (attendeeId: string, eventId: string) =>
  (await typesFor(attendeeId, eventId)).filter((type) => type === 'registration_withdrawn').length;

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
  it('TC-201-01 every type in NOTIFICATION_TYPES, the 15 before SCRUM-201, its 3 and SCRUM-191's 1, is accepted by notifications_type_known', async () => {
    const eventId = await createEvent();
    const recipient = await createAttendee();

    const { error } = await admin.from('notifications').insert(
      NOTIFICATION_TYPES.map((type) => ({ recipient_id: recipient, type, event_request_id: eventId, message: type })),
    );

    expect(error).toBeNull();
    expect(NOTIFICATION_TYPES).toHaveLength(19);
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

describe('AC3: a registration refused because the event is full tells the attendee so', () => {
  it(
    'TC-201-04 at capacity (3 of 3): refused, no row for the attendee, and one notification that the event is full',
    async () => {
      const eventId = await createEvent({ capacity: 3 });
      await fill(eventId, 3);
      const b = await createAttendee();

      const error = await refusal(registerForEvent(eventId, b, VALID, NOW));

      expect(error).toBeInstanceOf(CapacityExceededError);
      expect(error).toMatchObject({ message: NO_PLACES_REMAINING });
      const rows = await registeredRows(eventId);
      expect(rows).toHaveLength(3);
      expect(rows.map((row) => row.attendee_id)).not.toContain(b);
      const sent = await notificationsFor(b, eventId);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        type: 'registration_refused_full',
        readAt: null,
        message: `Your registration for "${EVENT_NAME}" on 17/11/2026 was not accepted: the event is full.`,
      });
    },
    TIMEOUT,
  );

  it(
    'TC-201-04 an event with no capacity set (CL-63) is refused and told the same',
    async () => {
      const eventId = await createEvent({ capacity: null });
      const b = await createAttendee();

      expect(await refusal(registerForEvent(eventId, b, VALID, NOW))).toBeInstanceOf(CapacityExceededError);

      expect(await registeredRows(eventId)).toEqual([]);
      expect(await typesFor(b, eventId)).toEqual(['registration_refused_full']);
    },
    TIMEOUT,
  );

  it(
    'TC-201-05 a full event whose period has closed is refused as closed, and not told it is full; opening a full page sends nothing',
    async () => {
      const closedId = await createEvent({ capacity: 3, start: '2026-10-22', end: '2026-10-31' });
      // Filled while open, before the period closed.
      for (const id of [await createAttendee(), await createAttendee(), await createAttendee()]) {
        await registerForEvent(closedId, id, VALID, new Date('2026-10-30T10:00:00+08:00'));
      }
      const fullId = await createEvent({ capacity: 3 });
      await fill(fullId, 3);
      const a = await createAttendee();

      expect(await refusal(registerForEvent(closedId, a, VALID, NOW))).toMatchObject({
        message: 'Registration closed on 31/10/2026.',
      });
      expect((await getRegistrationPage(fullId, a, NOW)).full).toBe(true);

      expect(await typesFor(a, closedId)).toEqual([]);
      expect(await typesFor(a, fullId)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'TC-201-06 two attendees going for the last place at once: one confirmed, the other told the event is full',
    async () => {
      const eventId = await createEvent({ capacity: 3 });
      await fill(eventId, 2);
      const [a, b] = [await createAttendee(), await createAttendee()];

      const results = await Promise.allSettled([a, b].map((id) => registerForEvent(eventId, id, VALID, NOW)));

      const winners = [a, b].filter((_, i) => results[i]?.status === 'fulfilled');
      const losers = [a, b].filter((_, i) => results[i]?.status === 'rejected');
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      const [winner, loser] = [winners[0] as string, losers[0] as string];
      expect(await typesFor(winner, eventId)).toEqual(['registration_confirmed']);
      expect(await typesFor(loser, eventId)).toEqual(['registration_refused_full']);
      expect(await registeredRows(eventId)).toHaveLength(3);
    },
    TIMEOUT,
  );
});

describe('AC4: a confirmed withdrawal sends the attendee a notification confirming it', () => {
  it(
    'TC-201-07 the attendee gets one unread notification with the event and their reference, newest first; nobody else does',
    async () => {
      const eventId = await createEvent({ capacity: 3 });
      const [a, b] = [await createAttendee(), await createAttendee()];
      const registration = await registerForEvent(eventId, a, VALID, NOW);
      await registerForEvent(eventId, b, VALID, NOW);

      await withdraw(eventId, registration.id, a);

      const sent = await notificationsFor(a, eventId);
      expect(sent.map((notification) => notification.type)).toEqual(['registration_withdrawn', 'registration_confirmed']);
      expect(sent[0]).toMatchObject({
        readAt: null,
        message: `You have withdrawn from "${EVENT_NAME}" on 17/11/2026. Your registration ${registration.reference} is now Withdrawn.`,
      });
      expect(await typesFor(b, eventId)).toEqual(['registration_confirmed']);
    },
    TIMEOUT,
  );

  it(
    "TC-201-08 two withdrawals sent together send one notification; another attendee's registration sends none",
    async () => {
      const eventId = await createEvent({ capacity: 3 });
      const [a, b] = [await createAttendee(), await createAttendee()];
      const registration = await registerForEvent(eventId, a, VALID, NOW);
      const theirs = await registerForEvent(eventId, b, VALID, NOW);

      const results = await Promise.allSettled([withdraw(eventId, registration.id, a), withdraw(eventId, registration.id, a)]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(await withdrawnCount(a, eventId)).toBe(1);

      expect(await refusal(withdraw(eventId, theirs.id, a))).toBeInstanceOf(NotFoundError);
      expect(await withdrawnCount(a, eventId)).toBe(1);
      expect(await withdrawnCount(b, eventId)).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'TC-201-09 withdrawn and notified on 16/11/2026 23:59 SGT; refused with nothing sent from 00:00 SGT on 17/11/2026, the event date',
    async () => {
      const lastDay = await createEvent({ capacity: 3 });
      const eventDay = await createEvent({ capacity: 3 });
      const a = await createAttendee();
      const before = await registerForEvent(lastDay, a, VALID, NOW);
      const on = await registerForEvent(eventDay, a, VALID, NOW);

      await withdraw(lastDay, before.id, a, new Date('2026-11-16T23:59:00+08:00'));
      expect(await withdrawnCount(a, lastDay)).toBe(1);

      const error = await refusal(withdraw(eventDay, on.id, a, new Date('2026-11-16T16:00:00Z')));
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).message).toBe(EVENT_TAKEN_PLACE);
      expect(await withdrawnCount(a, eventDay)).toBe(0);
    },
    TIMEOUT,
  );
});
