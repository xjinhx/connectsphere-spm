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
});

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
