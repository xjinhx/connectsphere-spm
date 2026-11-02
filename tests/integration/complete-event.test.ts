import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { addDays } from '@/domain/equipment-reservation/policy';
import { NOT_ENDED_YET, completionStatusRefusal } from '@/domain/event-status/policy';
import { completeEvent, completePastEvents, getEventCompletion } from '@/domain/event-status/service';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import type { Role } from '@/domain/identity/roles';
import { todayInSingapore, toSingaporeISODate } from '@/domain/shared/dates';
import { ConflictError, ForbiddenError } from '@/domain/shared/errors';
import { createVenue } from '@/domain/venues/service';
import { ensureTestClientOrganisation, TEST_CLIENT_ORGANISATION_ID } from './fixtures/clientOrganisation';

/**
 * SCRUM-104 Mark an event as completed, against the local Supabase stack
 * (`npm run db:start`, then the migrations applied).
 *
 * The rules on their own are in tests/unit/complete-event.test.ts, with the AC
 * text. What only a real database can show is here: that the end date is read
 * from the event's confirmed bookings (or its proposed date), that a refusal
 * leaves the status as it was, that a completion records the time and the
 * coordinator, and that the completion check completes Preparation events 7 or
 * more days past their end date and nothing else.
 *
 * Events are written straight into the status each case starts from, with
 * dates relative to today in Singapore, the day both rules are judged against.
 * The completion check is complete_past_events, which pg_cron runs daily; here
 * it is run directly through completePastEvents. It looks at every event in
 * the database, so these tests run serially (--no-file-parallelism).
 *
 * Test case IDs are from the SCRUM-104 tab of Marcus's Sprint 4 test cases
 * (TC-104-nn).
 */

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const TODAY = todayInSingapore();
const day = (offset: number) => addDays(TODAY, offset);

type Account = { userId: string; roles: Role[] };

const accountIds: string[] = [];
const eventIds: string[] = [];
let locationId: string;
let venueId: string;

let manager: Account;
let organiser: Account;
let coordinator: Account;
let otherCoordinator: Account;
let safetyOfficer: Account;

async function createAccount(label: string, roles: Role[]): Promise<Account> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+complete${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  accountIds.push(data.user.id);
  const { error: profileError } = await admin.from('profiles').update({ roles, full_name: label }).eq('id', data.user.id);
  if (profileError) throw new Error(`could not set up profile for ${label}: ${profileError.message}`);
  return { userId: data.user.id, roles };
}

/**
 * An event in `status`, assigned to `coordinator`, on `proposedDate`. A Draft
 * is neither submitted, decided nor assigned; a Submitted one is not decided
 * yet; a Rejected one carries its reason, as the event_request constraints
 * require.
 */
async function createEvent(status: EventRequestStatus, proposedDate: string): Promise<string> {
  const now = new Date().toISOString();
  const draft = status === 'draft';
  const decided = !draft && status !== 'submitted';
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiser.userId,
      client_organisation_id: TEST_CLIENT_ORGANISATION_ID,
      name: `Harbour Gala ${RUN}`,
      proposed_date: proposedDate,
      start_time: '10:00',
      end_time: '12:00',
      status,
      submitted_at: draft ? null : now,
      decision: decided ? (status === 'rejected' ? 'rejected' : 'approved') : null,
      rejection_reason: status === 'rejected' ? 'Date clashes with a client blackout' : null,
      decided_by: decided ? coordinator.userId : null,
      decided_at: decided ? now : null,
      coordinator_id: draft ? null : coordinator.userId,
      assigned_by: draft ? null : manager.userId,
      assigned_at: draft ? null : now,
    })
    .select('id')
    .single();
  if (error) throw new Error(`could not create test event: ${error.message}`);
  eventIds.push(data.id);
  return data.id;
}

// Each booking takes the next hour at the one test venue, so no two overlap.
let nextHour = 7;

/** A confirmed booking on `date`, as Venue Staff approving its line leaves it. */
async function book(eventId: string, date: string) {
  const hour = String(nextHour++).padStart(2, '0');
  const { error } = await admin
    .from('venue_booking')
    .insert({ venue_id: venueId, event_request_id: eventId, date, start_time: `${hour}:00`, end_time: `${hour}:45` });
  if (error) throw new Error(`could not create test booking: ${error.message}`);
}

const asCoordinator = () => ({ userId: coordinator.userId, roles: coordinator.roles });

async function stored(eventId: string) {
  const { data, error } = await admin
    .from('event_request')
    .select('status, completed_at, completed_by')
    .eq('id', eventId)
    .single();
  if (error) throw new Error(`could not read test event: ${error.message}`);
  return data;
}

/** The refusal's message, failing the test if it was not a refusal. */
async function refusalOf(eventId: string): Promise<string> {
  const error = await completeEvent(eventId, asCoordinator()).then(
    () => {
      throw new Error('expected marking it completed to be refused');
    },
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ConflictError);
  return (error as ConflictError).message;
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  manager = await createAccount('manager', ['operations_manager']);
  organiser = await createAccount('organiser', ['event_organiser']);
  coordinator = await createAccount('coordinator', ['coordinator']);
  otherCoordinator = await createAccount('othercoordinator', ['coordinator']);
  safetyOfficer = await createAccount('safetyofficer', ['safety_officer']);

  const { data: location, error } = await admin.from('locations').insert({ name: `Complete Location ${RUN}` }).select('id').single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;
  const venue = await createVenue({ name: `Marina Bay Ballroom ${RUN}`, locationId, maxCapacity: 200, opensAt: '07:00', closesAt: '23:00' });
  venueId = venue.id;
});

afterAll(async () => {
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  if (venueId) await admin.from('venues').delete().eq('id', venueId);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
  for (const id of accountIds) await admin.auth.admin.deleteUser(id);
});

describe('AC1 — the coordinator marks a Preparation event completed after its end date', () => {
  it("TC-104-01: Completed, with today's date and the coordinator recorded", async () => {
    const id = await createEvent('preparation', day(-1));
    await book(id, day(-1));

    expect(await completeEvent(id, asCoordinator())).toEqual({ id, status: 'completed' });

    const row = await stored(id);
    expect(row.status).toBe('completed');
    expect(row.completed_by).toBe(coordinator.userId);
    expect(row.completed_at).not.toBeNull();
    expect(toSingaporeISODate(new Date(row.completed_at ?? ''))).toBe(TODAY);
    expect((await getEventCompletion(id)).completed).toEqual({ on: TODAY, byName: 'coordinator' });
  });

  it('TC-104-02: with no booking, the proposed date is the end date', async () => {
    const id = await createEvent('preparation', day(-1));

    await completeEvent(id, asCoordinator());

    expect((await stored(id)).status).toBe('completed');
  });
});

describe('AC4 — not before the end date has passed', () => {
  it('TC-104-03: an event ending today is refused; still Preparation', async () => {
    const id = await createEvent('preparation', day(0));
    await book(id, day(0));

    expect(await refusalOf(id)).toBe(NOT_ENDED_YET);
    expect((await stored(id)).status).toBe('preparation');
  });

  it('TC-104-04: an event in 10 days is refused; still Preparation', async () => {
    const id = await createEvent('preparation', day(10));
    await book(id, day(10));

    expect(await refusalOf(id)).toBe(NOT_ENDED_YET);
    expect((await stored(id)).status).toBe('preparation');
  });

  it('TC-104-05: bookings 3 days ago and tomorrow: the last booked day is the end date, so refused', async () => {
    const id = await createEvent('preparation', day(-3));
    await book(id, day(-3));
    await book(id, day(1));

    expect(await refusalOf(id)).toBe(NOT_ENDED_YET);
    expect((await stored(id)).status).toBe('preparation');
  });
});

describe('AC5 — not before the event has passed the Operational Safety Check', () => {
  it('TC-104-06: a Confirmed event awaiting its check is refused; still Confirmed', async () => {
    const id = await createEvent('confirmed', day(-1));
    await book(id, day(-1));

    expect(await refusalOf(id)).toBe(completionStatusRefusal('confirmed'));
    expect((await stored(id)).status).toBe('confirmed');
  });

  it('TC-104-07: an event back in Planning after a Rejected check is refused; still Planning', async () => {
    const id = await createEvent('planning', day(-1));
    await book(id, day(-1));
    const { error } = await admin.from('safety_check').insert({
      event_request_id: id,
      decision: 'rejected',
      note: 'No crowd control plan for the ballroom exits',
      decided_by: safetyOfficer.userId,
    });
    if (error) throw new Error(`could not record test safety check: ${error.message}`);

    expect(await refusalOf(id)).toBe(completionStatusRefusal('planning'));
    expect((await stored(id)).status).toBe('planning');
  });

  it('TC-104-08: an Approved event is refused; still Approved', async () => {
    const id = await createEvent('approved', day(-1));

    expect(await refusalOf(id)).toBe(completionStatusRefusal('approved'));
    expect((await stored(id)).status).toBe('approved');
  });
});

describe('Supplementary — who may mark an event completed', () => {
  it('TC-104-09: a coordinator the event is not assigned to is refused; still Preparation', async () => {
    const id = await createEvent('preparation', day(-1));
    await book(id, day(-1));

    await expect(completeEvent(id, { userId: otherCoordinator.userId, roles: otherCoordinator.roles })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect((await stored(id)).status).toBe('preparation');
  });
});

describe('AC2, AC3 — the completion check', () => {
  it("TC-104-10: a Preparation event ended 7 days ago is Completed, system-completed, today", async () => {
    const id = await createEvent('preparation', day(-7));

    expect(await completePastEvents(TODAY)).toBeGreaterThanOrEqual(1);

    const row = await stored(id);
    expect(row.status).toBe('completed');
    expect(row.completed_by).toBeNull();
    expect(toSingaporeISODate(new Date(row.completed_at ?? ''))).toBe(TODAY);
    expect((await getEventCompletion(id)).completed).toEqual({ on: TODAY, byName: null });
  });

  it('TC-104-11: an event ended 8 days ago (a missed day) is still Completed, system-completed', async () => {
    const id = await createEvent('preparation', day(-8));

    await completePastEvents(TODAY);

    const row = await stored(id);
    expect(row.status).toBe('completed');
    expect(row.completed_by).toBeNull();
  });

  it('TC-104-12: an event ended exactly 6 days ago is left in Preparation', async () => {
    const id = await createEvent('preparation', day(-6));

    await completePastEvents(TODAY);

    expect(await stored(id)).toEqual({ status: 'preparation', completed_at: null, completed_by: null });
  });

  it('TC-104-13: events in any other status, ended 7 days ago, are left as they are', async () => {
    const statuses: EventRequestStatus[] = ['submitted', 'approved', 'planning', 'confirmed', 'cancelled', 'draft', 'rejected'];
    const ids = await Promise.all(statuses.map((status) => createEvent(status, day(-7))));

    await completePastEvents(TODAY);

    for (const [index, id] of ids.entries()) {
      expect(await stored(id)).toEqual({ status: statuses[index], completed_at: null, completed_by: null });
    }
  });

  it('TC-104-14: an event the coordinator already completed keeps its date and coordinator', async () => {
    const id = await createEvent('preparation', day(-10));
    await completeEvent(id, asCoordinator());
    const before = await stored(id);

    await completePastEvents(TODAY);

    const after = await stored(id);
    expect(after).toEqual(before);
    expect(after.completed_by).toBe(coordinator.userId);
  });
});
