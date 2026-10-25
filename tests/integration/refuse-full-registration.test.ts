import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { getRegistrationPage, registerForEvent } from '@/domain/event-registration/service';
import { NO_PLACES_REMAINING } from '@/domain/event-registration/policy';
import { CapacityExceededError } from '@/domain/shared/errors';
import { TEST_CLIENT_ORGANISATION_ID, ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-182 Refuse registration once the event is full (Jira, authoritative):
 *   AC1 with the capacity reached, no registration is created and the event
 *       is shown as full;
 *   AC2 with one place left, two attendees submitting at the same moment:
 *       exactly one succeeds, the other is refused as full;
 *   AC3 a place released by a withdrawal can be registered for (no waiting
 *       list in Release 1).
 * AC4 moved to SCRUM-52 (CL-32); not tested.
 *
 * Runs against the local Supabase stack, because what is being proved is the
 * count in event_has_places_remaining and the event row lock in
 * register_for_event; a mocked unit test cannot show either. The clock is
 * fixed at 30/10/2026 10:00 Singapore time by passing `now`. Capacity 3 with
 * 3 registered stands in for the sheet's 20 of 20: the same boundary, fewer
 * accounts to create.
 *
 * Test case IDs are from SCRUM-182-test-cases.xlsx (TC-182-nn).
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const NOW = new Date('2026-10-30T10:00:00+08:00');
const VALID = { fullName: 'Tan Mei Ling', email: 'attendee@example.com', contactNumber: '+65 9123 4567' };
// Each case creates several accounts; the default 5 s is too tight on a cold local stack.
const TIMEOUT = 20_000;

let organiserId: string;
const attendeeIds: string[] = [];
const eventIds: string[] = [];

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+full${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  return data.user.id;
}

async function createAttendee(): Promise<string> {
  const id = await createUser(`attendee${attendeeIds.length}`);
  attendeeIds.push(id);
  return id;
}

/** An event open for registration on 30/10/2026, with `capacity` places (null: not set). */
async function createEvent(capacity: number | null): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: TEST_CLIENT_ORGANISATION_ID,
      name: `Client Appreciation Night ${RUN}`,
      proposed_date: '2026-11-15',
      registration_start_date: '2026-10-27',
      registration_end_date: '2026-11-04',
      registration_capacity: capacity,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test event: ${error?.message}`);
  eventIds.push(data.id);
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

async function rowsFor(eventId: string) {
  const { data, error } = await admin
    .from('event_registration')
    .select('attendee_id, status, reference')
    .eq('event_request_id', eventId);
  if (error) throw new Error(error.message);
  return data;
}

const registered = async (eventId: string) => (await rowsFor(eventId)).filter((row) => row.status === 'registered');

/**
 * Withdrawing is SCRUM-184's. D-25: until it is on main, set the status it will
 * write by hand; what these cases exercise is the count, which is this story's.
 */
async function withdraw(eventId: string, attendeeId: string) {
  const { error } = await admin
    .from('event_registration')
    .update({ status: 'withdrawn' })
    .eq('event_request_id', eventId)
    .eq('attendee_id', attendeeId)
    .eq('status', 'registered');
  if (error) throw new Error(error.message);
}

/** Sends one registration per attendee, all at the same moment. */
const race = (eventId: string, attendees: string[]) =>
  Promise.allSettled(attendees.map((attendee) => registerForEvent(eventId, attendee, VALID, NOW)));

/** What one raced request got, named, so a failure says why. */
const outcome = (result: PromiseSettledResult<unknown>) =>
  result.status === 'fulfilled'
    ? 'registered'
    : result.reason instanceof CapacityExceededError
      ? `full: ${result.reason.message}`
      : `other: ${String(result.reason)} ${JSON.stringify((result.reason as { details?: unknown }).details)}`;

/** register_for_event on its own, as the database sees it. */
const callDatabase = (eventId: string, attendeeId: string) =>
  admin.rpc('register_for_event', {
    p_event_request_id: eventId,
    p_attendee_id: attendeeId,
    p_full_name: VALID.fullName,
    p_email: VALID.email,
    p_contact_number: VALID.contactNumber,
    p_today: '2026-10-30',
  });

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
});

afterAll(async () => {
  // Registrations go with their events (cascade), then the accounts can go.
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of [organiserId, ...attendeeIds]) if (id) await admin.auth.admin.deleteUser(id);
  // About fifty accounts to delete; the default 10 s hook timeout is too tight.
}, 120_000);

describe('AC1: a full event refuses registration and is shown as full', () => {
  it('TC-182-01 at capacity: refused as full by the service and by the database, and nothing is written', async () => {
    const eventId = await createEvent(3);
    await fill(eventId, 3);
    const attendee = await createAttendee();

    const error = await refusal(registerForEvent(eventId, attendee, VALID, NOW));

    expect(error).toBeInstanceOf(CapacityExceededError);
    expect((error as Error).message).toBe(NO_PLACES_REMAINING);
    // The database refuses on its own too, whatever the caller checked.
    expect((await callDatabase(eventId, attendee)).data).toBe('full');
    expect(await rowsFor(eventId)).toHaveLength(3);
    expect((await getRegistrationPage(eventId, attendee, NOW)).full).toBe(true);
  }, TIMEOUT);

  it('TC-182-02 no capacity set: refused the same way as a full event (PO, 25/10/2026)', async () => {
    const eventId = await createEvent(null);
    const attendee = await createAttendee();

    await expect(registerForEvent(eventId, attendee, VALID, NOW)).rejects.toThrow(NO_PLACES_REMAINING);
    expect((await callDatabase(eventId, attendee)).data).toBe('full');
    expect(await rowsFor(eventId)).toHaveLength(0);
    expect((await getRegistrationPage(eventId, attendee, NOW)).full).toBe(true);
  }, TIMEOUT);

  it('TC-182-03 taking the last place makes the event full for the next attendee', async () => {
    const eventId = await createEvent(3);
    await fill(eventId, 2);
    const [a, b] = [await createAttendee(), await createAttendee()];
    expect((await getRegistrationPage(eventId, a, NOW)).full).toBe(false);

    await expect(registerForEvent(eventId, a, VALID, NOW)).resolves.toMatchObject({ status: 'registered' });
    await expect(registerForEvent(eventId, b, VALID, NOW)).rejects.toThrow(CapacityExceededError);

    expect(await rowsFor(eventId)).toHaveLength(3);
    expect((await rowsFor(eventId)).some((row) => row.attendee_id === b)).toBe(false);
    expect((await getRegistrationPage(eventId, b, NOW)).full).toBe(true);
  }, TIMEOUT);

  it("TC-182-04 another event's full count does not stop registering for this one", async () => {
    const fullEvent = await createEvent(2);
    await fill(fullEvent, 2);
    const thisEvent = await createEvent(2);
    await fill(thisEvent, 1);
    const attendee = await createAttendee();

    await expect(registerForEvent(thisEvent, attendee, VALID, NOW)).resolves.toMatchObject({ status: 'registered' });
    await expect(registerForEvent(fullEvent, attendee, VALID, NOW)).rejects.toThrow(CapacityExceededError);

    expect(await rowsFor(thisEvent)).toHaveLength(2);
    expect(await rowsFor(fullEvent)).toHaveLength(2);
  }, TIMEOUT);
});

describe('AC2: two attendees going for the last place at the same moment', () => {
  it('TC-182-05 exactly one succeeds and the other is refused as full, every time (10 races)', async () => {
    // One race that passes may be luck; ten in a row on fresh events is not.
    for (let round = 0; round < 10; round += 1) {
      const eventId = await createEvent(3);
      await fill(eventId, 2);

      const results = await race(eventId, [await createAttendee(), await createAttendee()]);

      expect(results.map(outcome).sort()).toEqual([`full: ${NO_PLACES_REMAINING}`, 'registered']);
      expect(await registered(eventId)).toHaveLength(3);
    }
  }, 120_000);

  it('TC-182-06 five at once for one place: still exactly one, and the count never passes the capacity', async () => {
    const eventId = await createEvent(3);
    await fill(eventId, 2);
    const five = [];
    for (let i = 0; i < 5; i += 1) five.push(await createAttendee());

    const results = await race(eventId, five);

    const full = `full: ${NO_PLACES_REMAINING}`;
    expect(results.map(outcome).sort()).toEqual([full, full, full, full, 'registered']);
    expect(await registered(eventId)).toHaveLength(3);
  }, TIMEOUT);

  it('TC-182-07 two places left, two at once: both succeed (the lock makes the second wait, not fail)', async () => {
    const eventId = await createEvent(3);
    await fill(eventId, 1);

    const results = await race(eventId, [await createAttendee(), await createAttendee()]);

    expect(results.map(outcome)).toEqual(['registered', 'registered']);
    expect(await registered(eventId)).toHaveLength(3);
    await expect(registerForEvent(eventId, await createAttendee(), VALID, NOW)).rejects.toThrow(CapacityExceededError);
  }, TIMEOUT);

  it('TC-182-08 the attendee who lost the race is refused as full again on retry', async () => {
    const eventId = await createEvent(3);
    await fill(eventId, 2);
    const [a, b] = [await createAttendee(), await createAttendee()];
    const results = await race(eventId, [a, b]);
    const loser = results[0]!.status === 'rejected' ? a : b;

    const error = await refusal(registerForEvent(eventId, loser, VALID, NOW));

    expect(error).toBeInstanceOf(CapacityExceededError);
    expect((await rowsFor(eventId)).some((row) => row.attendee_id === loser)).toBe(false);
    expect(await registered(eventId)).toHaveLength(3);
    expect((await getRegistrationPage(eventId, loser, NOW)).full).toBe(true);
  }, TIMEOUT);
});

describe('AC3: a place released by a withdrawal (no waiting list in Release 1)', () => {
  it('TC-182-09 a withdrawal from a full event frees the place, the next attendee registers, and it is full again', async () => {
    const eventId = await createEvent(3);
    const [first] = await fill(eventId, 3);
    const [attendee, attendee2] = [await createAttendee(), await createAttendee()];
    await expect(registerForEvent(eventId, attendee, VALID, NOW)).rejects.toThrow(CapacityExceededError);

    await withdraw(eventId, first!);

    await expect(registerForEvent(eventId, attendee, VALID, NOW)).resolves.toMatchObject({ status: 'registered' });
    // One withdrawal frees one place, not more.
    await expect(registerForEvent(eventId, attendee2, VALID, NOW)).rejects.toThrow(CapacityExceededError);
    const rows = await rowsFor(eventId);
    expect(rows.filter((row) => row.status === 'registered')).toHaveLength(3);
    expect(rows.filter((row) => row.status === 'withdrawn')).toHaveLength(1);
  }, TIMEOUT);

  it('TC-182-10 capacity below the number registered: everyone stays, and registration reopens only below the capacity (PO, 25/10/2026)', async () => {
    const eventId = await createEvent(3);
    const [first, second] = await fill(eventId, 3);
    // Only the coordinator's save in SCRUM-185 changes the capacity; set by hand here.
    await admin.from('event_request').update({ registration_capacity: 2 }).eq('id', eventId);
    const attendee = await createAttendee();

    expect(await registered(eventId)).toHaveLength(3);
    await expect(registerForEvent(eventId, attendee, VALID, NOW)).rejects.toThrow(CapacityExceededError);

    await withdraw(eventId, first!);
    // 2 of 2: still full.
    await expect(registerForEvent(eventId, attendee, VALID, NOW)).rejects.toThrow(CapacityExceededError);

    await withdraw(eventId, second!);
    // 1 of 2: open again.
    await expect(registerForEvent(eventId, attendee, VALID, NOW)).resolves.toMatchObject({ status: 'registered' });

    const rows = await rowsFor(eventId);
    expect(rows.filter((row) => row.status === 'registered')).toHaveLength(2);
    expect(rows.filter((row) => row.status === 'withdrawn')).toHaveLength(2);
    // Nobody already registered was removed or told anything.
    const { count } = await admin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .in('recipient_id', rows.map((row) => row.attendee_id));
    expect(count).toBe(0);
  }, TIMEOUT);

  it('TC-182-11 the attendee who withdrew can take the freed place again, with a new reference', async () => {
    const eventId = await createEvent(3);
    const attendee = await createAttendee();
    const first = await registerForEvent(eventId, attendee, VALID, NOW);
    await fill(eventId, 2);

    await withdraw(eventId, attendee);
    const again = await registerForEvent(eventId, attendee, VALID, NOW);

    expect(again.reference).not.toBe(first.reference);
    const mine = (await rowsFor(eventId)).filter((row) => row.attendee_id === attendee);
    expect(mine.map((row) => row.status).sort()).toEqual(['registered', 'withdrawn']);
    expect(await registered(eventId)).toHaveLength(3);
  }, TIMEOUT);

  it('TC-182-12 no waiting list: someone refused while full is not registered, offered or notified when a place frees', async () => {
    const eventId = await createEvent(3);
    const [first] = await fill(eventId, 3);
    const refused = await createAttendee();
    await expect(registerForEvent(eventId, refused, VALID, NOW)).rejects.toThrow(CapacityExceededError);

    await withdraw(eventId, first!);

    // The place stays open until someone asks for it.
    expect((await rowsFor(eventId)).some((row) => row.attendee_id === refused)).toBe(false);
    expect(await registered(eventId)).toHaveLength(2);
    const { count } = await admin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', refused);
    expect(count).toBe(0);
    expect((await getRegistrationPage(eventId, refused, NOW)).full).toBe(false);

    await expect(registerForEvent(eventId, refused, VALID, NOW)).resolves.toMatchObject({ status: 'registered' });
  }, TIMEOUT);
});
