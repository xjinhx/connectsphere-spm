import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createVenue } from '@/domain/venues/service';
import { checkVenueSuitability, listSuitabilityChecks } from '@/domain/suitability/service';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-135 Check a selected venue against the event's requirements, against
 * the local Supabase stack. The rules on their own are
 * tests/unit/suitability-check.test.ts.
 *
 * AC3 is the part that needs the database: each check is stored, and
 * reopening the venue against the event shows the stored one, with the time
 * it was run, without running it again; once the event's requirements change,
 * it is shown as out of date.
 *
 * AC4 (a booking request's own needs) is not run here: booking requests get
 * their own attendance, layout and accessibility in SCRUM-230. The
 * accessibility cases on the sheet (TC-135-05 with accessibility unanswered,
 * TC-135-12) wait on SCRUM-137, which owns the accessibility rule.
 *
 * Test case IDs are from Joshua's Sprint 3 sheet (TC-135-nn); the venue is
 * S135 Hall: maximum 200, Theatre 120.
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let locationId: string;
let hallId: string;
let otherHallId: string;
let coordinatorId: string;
let otherCoordinatorId: string;
let organiserId: string;
const eventIds: string[] = [];

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+suitcheck${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  return data.user.id;
}

async function createEvent(expectedAttendance: number | null, roomLayout: string | null): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: CLIENT_ORGANISATION_ID,
      name: `Suitability Check Event ${RUN}`,
      expected_attendance: expectedAttendance,
      room_layout: roomLayout,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test event: ${error?.message}`);
  eventIds.push(data.id);
  await admin.from('event_request').update({ status: 'submitted' }).eq('id', data.id);
  await admin.from('event_request').update({ coordinator_id: coordinatorId, assigned_by: coordinatorId }).eq('id', data.id);
  return data.id;
}

async function storedRunCount(eventId: string) {
  const { count } = await admin
    .from('venue_suitability_check')
    .select('id', { count: 'exact', head: true })
    .eq('event_request_id', eventId);
  return count ?? 0;
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  const { data: location, error } = await admin.from('locations').insert({ name: `Suitability Check Location ${RUN}` }).select('id').single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;
  hallId = (await createVenue({ name: `S135 Hall ${RUN}`, locationId, maxCapacity: 200, layouts: [{ layout: 'theatre', capacity: 120 }] })).id;
  otherHallId = (await createVenue({ name: `S135 Annex ${RUN}`, locationId, maxCapacity: 300, layouts: [{ layout: 'theatre', capacity: 300 }] })).id;
  coordinatorId = await createUser('coordinator');
  otherCoordinatorId = await createUser('other-coordinator');
  organiserId = await createUser('organiser');
});

afterAll(async () => {
  // Events first: their stored checks go with them.
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of [hallId, otherHallId]) if (id) await admin.from('venues').delete().eq('id', id);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
  for (const id of [coordinatorId, otherCoordinatorId, organiserId]) if (id) await admin.auth.admin.deleteUser(id);
});

describe('checkVenueSuitability: SCRUM-135 AC1 and AC2', () => {
  it('TC-135-01 gives exactly one verdict, Suitable, for 80 in Theatre at S135 Hall', async () => {
    const result = await checkVenueSuitability(await createEvent(80, 'theatre'), { venueId: hallId }, coordinatorId);
    expect(result.verdict).toBe('suitable');
    expect(result.outOfDate).toBe(false);
  });

  it('TC-135-02 / TC-135-06 is Not suitable for 150, with the capacity listed as 150 against 120', async () => {
    const result = await checkVenueSuitability(await createEvent(150, 'theatre'), { venueId: hallId }, coordinatorId);
    expect(result.verdict).toBe('not_suitable');
    expect(result.requirements).toEqual([
      expect.objectContaining({ outcome: 'not_met', eventValue: '150 expected', venueValue: '120 (Theatre capacity)' }),
    ]);
  });

  it('TC-135-03 / TC-135-07 is Suitable with concerns with no attendance, listing it as not recorded', async () => {
    const result = await checkVenueSuitability(await createEvent(null, 'theatre'), { venueId: hallId }, coordinatorId);
    expect(result.verdict).toBe('suitable_with_concerns');
    expect(result.requirements[0]).toMatchObject({ outcome: 'unverified', eventValue: 'Not recorded' });
  });
});

describe('listSuitabilityChecks: SCRUM-135 AC3, a stored check is shown again without running it', () => {
  it('TC-135-09 shows the stored verdict, unmet requirement and check time, and runs nothing', async () => {
    const eventId = await createEvent(150, 'theatre');
    const run = await checkVenueSuitability(eventId, { venueId: hallId }, coordinatorId);
    const runsBefore = await storedRunCount(eventId);

    const [reopened] = await listSuitabilityChecks(eventId, coordinatorId);

    expect(reopened).toEqual({ ...run, outOfDate: false });
    expect(reopened?.checkedAt).toBe(run.checkedAt);
    expect(await storedRunCount(eventId)).toBe(runsBefore);
  });

  it('TC-135-10 marks the stored check out of date once the expected attendance changes', async () => {
    const eventId = await createEvent(80, 'theatre');
    await checkVenueSuitability(eventId, { venueId: hallId }, coordinatorId);

    await admin.from('event_request').update({ expected_attendance: 150 }).eq('id', eventId);

    const [reopened] = await listSuitabilityChecks(eventId, coordinatorId);
    expect(reopened).toMatchObject({ verdict: 'suitable', outOfDate: true });
  });

  it('keeps the stored check current when something the check does not read changes', async () => {
    const eventId = await createEvent(80, 'theatre');
    await checkVenueSuitability(eventId, { venueId: hallId }, coordinatorId);

    await admin.from('event_request').update({ description: 'Updated description' }).eq('id', eventId);

    const [reopened] = await listSuitabilityChecks(eventId, coordinatorId);
    expect(reopened?.outOfDate).toBe(false);
  });

  it('shows the latest run of each venue checked, newest first', async () => {
    const eventId = await createEvent(150, 'theatre');
    await checkVenueSuitability(eventId, { venueId: hallId }, coordinatorId);
    await admin.from('event_request').update({ expected_attendance: 100 }).eq('id', eventId);
    const latestHall = await checkVenueSuitability(eventId, { venueId: hallId }, coordinatorId);
    const annex = await checkVenueSuitability(eventId, { venueId: otherHallId }, coordinatorId);

    const checks = await listSuitabilityChecks(eventId, coordinatorId);

    expect(checks.map((check) => [check.venue.id, check.verdict, check.checkedAt])).toEqual([
      [otherHallId, annex.verdict, annex.checkedAt],
      [hallId, 'suitable', latestHall.checkedAt],
    ]);
  });

  it('refuses a coordinator the event is not assigned to', async () => {
    const eventId = await createEvent(150, 'theatre');
    await checkVenueSuitability(eventId, { venueId: hallId }, coordinatorId);

    await expect(listSuitabilityChecks(eventId, otherCoordinatorId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
