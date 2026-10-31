import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getRegistrationPage,
  listMyRegistrations,
  registerForEvent,
  withdrawRegistration,
} from '@/domain/event-registration/service';
import { ALREADY_WITHDRAWN, EVENT_TAKEN_PLACE } from '@/domain/event-registration/policy';
import { CapacityExceededError, DomainError, NotFoundError } from '@/domain/shared/errors';
import { TEST_CLIENT_ORGANISATION_ID, ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-184 Withdraw my registration (Jira, authoritative):
 *   AC1 an active registration for an event that has not taken place, withdrawn
 *       and confirmed, becomes Withdrawn and its place returns to the event;
 *   AC2 the attendee's registrations show it as Withdrawn rather than removed
 *       (SCRUM-180's My registrations section and its listMyRegistrations,
 *       CL-70);
 *   AC3 once the event has taken place (CL-69: from its event date), no
 *       withdraw action is offered.
 *
 * Runs against the local Supabase stack, because what is being proved is the
 * row itself: kept, set to withdrawn, and no longer counted by SCRUM-182's
 * event_has_places_remaining. The clock is fixed at 30/10/2026 10:00
 * Singapore time by passing `now`. Capacity 3 stands in for the sheet's 20:
 * the same boundary, fewer accounts to create.
 *
 * Test case IDs are from SCRUM-184-test-cases.xlsx (TC-184-nn).
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
    email: `${label}+withdraw${RUN}@connectsphere.example.com`,
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

/** An event open for registration on 30/10/2026, held on `eventDate`, with `capacity` places. */
async function createEvent(capacity: number, eventDate = '2026-11-15'): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: TEST_CLIENT_ORGANISATION_ID,
      name: `Client Appreciation Night ${RUN}`,
      proposed_date: eventDate,
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

/** Registers a new attendee for the event; returns who and their registration id. */
async function register(eventId: string, attendeeId?: string): Promise<{ attendeeId: string; registrationId: string }> {
  const id = attendeeId ?? (await createAttendee());
  const registration = await registerForEvent(eventId, id, VALID, NOW);
  return { attendeeId: id, registrationId: registration.id };
}

async function rowsFor(eventId: string) {
  const { data, error } = await admin
    .from('event_registration')
    .select('id, attendee_id, status, reference')
    .eq('event_request_id', eventId);
  if (error) throw new Error(error.message);
  return data;
}

const registered = async (eventId: string) => (await rowsFor(eventId)).filter((row) => row.status === 'registered');

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
}, 120_000);

describe('AC1: withdrawing gives the place back', () => {
  it('TC-184-01 the row is kept and set to withdrawn, and the next attendee can take the place', async () => {
    const eventId = await createEvent(3);
    const a = await register(eventId);
    await register(eventId);
    await register(eventId);
    const b = await createAttendee();
    await expect(registerForEvent(eventId, b, VALID, NOW)).rejects.toThrow(CapacityExceededError);

    const withdrawn = await withdrawRegistration(eventId, a.registrationId, a.attendeeId, NOW);

    expect(withdrawn).toMatchObject({ id: a.registrationId, status: 'withdrawn' });
    const row = (await rowsFor(eventId)).find((r) => r.id === a.registrationId);
    expect(row).toMatchObject({ attendee_id: a.attendeeId, status: 'withdrawn' });
    expect(await registered(eventId)).toHaveLength(2);
    expect((await getRegistrationPage(eventId, b, NOW)).full).toBe(false);
    await expect(registerForEvent(eventId, b, VALID, NOW)).resolves.toMatchObject({ status: 'registered' });
  }, TIMEOUT);

  it('TC-184-03 withdrawing twice is refused, and two withdrawals at once change it once', async () => {
    const eventId = await createEvent(3);
    const a = await register(eventId);
    const c = await register(eventId);
    await withdrawRegistration(eventId, a.registrationId, a.attendeeId, NOW);

    const error = await refusal(withdrawRegistration(eventId, a.registrationId, a.attendeeId, NOW));
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: 'INVALID_TRANSITION', message: ALREADY_WITHDRAWN });

    const results = await Promise.allSettled([
      withdrawRegistration(eventId, c.registrationId, c.attendeeId, NOW),
      withdrawRegistration(eventId, c.registrationId, c.attendeeId, NOW),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected' && (r.reason as Error).message === ALREADY_WITHDRAWN)).toHaveLength(1);

    const rows = await rowsFor(eventId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'withdrawn')).toBe(true);
  }, TIMEOUT);

  it("TC-184-04 an attendee cannot withdraw another attendee's registration", async () => {
    const eventId = await createEvent(3);
    const owner = await register(eventId);
    const other = await createAttendee();

    await expect(withdrawRegistration(eventId, owner.registrationId, other, NOW)).rejects.toThrow(NotFoundError);

    expect((await rowsFor(eventId))[0]).toMatchObject({ attendee_id: owner.attendeeId, status: 'registered' });
  }, TIMEOUT);
});

describe('AC2: a withdrawn registration is shown as Withdrawn, not removed (SCRUM-180 My registrations, CL-70)', () => {
  it('TC-184-05 both registrations are still listed; the withdrawn one keeps its reference', async () => {
    const night = await createEvent(3);
    const lunch = await createEvent(3, '2026-11-20');
    const a = await register(night);
    await register(lunch, a.attendeeId);
    const before = await listMyRegistrations(a.attendeeId);

    await withdrawRegistration(night, a.registrationId, a.attendeeId, NOW);

    const list = await listMyRegistrations(a.attendeeId);
    expect(list).toHaveLength(2);
    const withdrawn = list.find((row) => row.eventRequestId === night);
    expect(withdrawn).toMatchObject({
      registrationId: a.registrationId,
      status: 'withdrawn',
      reference: before.find((row) => row.eventRequestId === night)?.reference,
    });
    expect(list.find((row) => row.eventRequestId === lunch)?.status).toBe('registered');
  }, TIMEOUT);

  it('TC-184-06 withdrawn then registered again: two rows for the event, and the page shows the new one with Withdraw', async () => {
    const eventId = await createEvent(3);
    const first = await register(eventId);
    await withdrawRegistration(eventId, first.registrationId, first.attendeeId, NOW);
    const second = await register(eventId, first.attendeeId);

    const list = await listMyRegistrations(first.attendeeId);
    expect(list.map((row) => [row.registrationId, row.status]).sort()).toEqual(
      [
        [first.registrationId, 'withdrawn'],
        [second.registrationId, 'registered'],
      ].sort(),
    );
    expect(new Set(list.map((row) => row.reference)).size).toBe(2);
    const page = await getRegistrationPage(eventId, first.attendeeId, NOW);
    expect(page.registration?.id).toBe(second.registrationId);
    expect(page.canWithdraw).toBe(true);
  }, TIMEOUT);
});

describe('AC3: no withdraw once the event has taken place (CL-69: from its event date)', () => {
  it('TC-184-07 a past event: refused, still Registered, and neither the page nor the list offers Withdraw', async () => {
    const eventId = await createEvent(3, '2026-10-20');
    const a = await register(eventId);

    const error = await refusal(withdrawRegistration(eventId, a.registrationId, a.attendeeId, NOW));

    expect(error).toMatchObject({ code: 'INVALID_TRANSITION', message: EVENT_TAKEN_PLACE });
    expect((await rowsFor(eventId))[0]?.status).toBe('registered');
    expect((await getRegistrationPage(eventId, a.attendeeId, NOW)).canWithdraw).toBe(false);
  }, TIMEOUT);

  it('TC-184-08 an event dated today (Singapore): refused, still Registered', async () => {
    const eventId = await createEvent(3, '2026-10-30');
    const a = await register(eventId);

    await expect(withdrawRegistration(eventId, a.registrationId, a.attendeeId, NOW)).rejects.toThrow(EVENT_TAKEN_PLACE);
    expect((await rowsFor(eventId))[0]?.status).toBe('registered');
    expect((await getRegistrationPage(eventId, a.attendeeId, NOW)).canWithdraw).toBe(false);
  }, TIMEOUT);

  it('TC-184-09 an event dated tomorrow: offered, and the withdrawal frees a place', async () => {
    const eventId = await createEvent(3, '2026-10-31');
    const a = await register(eventId);
    await register(eventId);
    await register(eventId);
    expect((await getRegistrationPage(eventId, a.attendeeId, NOW)).canWithdraw).toBe(true);

    await expect(withdrawRegistration(eventId, a.registrationId, a.attendeeId, NOW)).resolves.toMatchObject({
      status: 'withdrawn',
    });
    expect(await registered(eventId)).toHaveLength(2);
  }, TIMEOUT);
});
