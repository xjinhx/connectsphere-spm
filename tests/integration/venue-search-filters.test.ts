import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createVenue, searchVenues } from '@/domain/venues/service';
import { todayInSingapore } from '@/domain/shared/dates';
import { ValidationError } from '@/domain/shared/errors';
import { ensureTestClientOrganisation, TEST_CLIENT_ORGANISATION_ID } from './fixtures/clientOrganisation';

/**
 * SCRUM-130 Filter by capacity, layout, accessibility, facilities and location,
 * against Postgres: the venues are saved through createVenue with their
 * layouts, facilities and accessibility features, and searchVenues reads them
 * back and filters them. The rules on their own are in
 * tests/unit/venue-search-filters.test.ts, with the AC text.
 *
 * The four venues are the sheet's S130-A to S130-D, at locations, facilities
 * and accessibility features of this run's own (the search reads the whole
 * catalogue and other files add venues too), so every check looks only at
 * this run's venues.
 *
 * Test case IDs are from the SCRUM-130 tab of the Sprint 4 sheet (TC-130-nn).
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The Singapore date `days` from today, as YYYY-MM-DD. */
function daysFromToday(days: number): string {
  const date = new Date(`${todayInSingapore()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const DATE = daysFromToday(60);

const locationIds: string[] = [];
const facilityIds: string[] = [];
const featureIds: string[] = [];
const venueIds: string[] = [];
const requestIds: string[] = [];
let organiserId: string;

const id = {
  bugis: '',
  jurong: '',
  marina: '',
  projector: '',
  sound: '',
  whiteboard: '',
  stepFree: '',
  hearingLoop: '',
};
const venue = { A: '', B: '', C: '', D: '' };

async function insertNamed(table: 'locations' | 'facilities' | 'accessibility_features', name: string, into: string[]) {
  const { data, error } = await admin.from(table).insert({ name: `${name} ${RUN}` }).select('id').single();
  if (error || !data) throw new Error(`could not create test ${table} row: ${error?.message}`);
  into.push(data.id);
  return data.id as string;
}

async function addVenue(label: string, input: Record<string, unknown>) {
  const created = await createVenue({ name: `S130-${label} ${RUN}`, opensAt: '07:00', closesAt: '24:00', ...input });
  venueIds.push(created.id);
  return created.id;
}

/** Which of this run's S130 venues the search returns, by letter, in order. */
async function found(filters: Record<string, unknown>, start = '10:00', end = '12:00'): Promise<string[]> {
  const result = await searchVenues({ date: DATE, start, end, ...filters });
  const byId = new Map(Object.entries(venue).map(([letter, venueId]) => [venueId, letter]));
  return result.venues
    .map((entry) => byId.get(entry.id))
    .filter((letter): letter is string => letter !== undefined)
    .sort();
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  id.bugis = await insertNamed('locations', 'S130 Bugis', locationIds);
  id.jurong = await insertNamed('locations', 'S130 Jurong East', locationIds);
  id.marina = await insertNamed('locations', 'S130 Marina Bay', locationIds);
  id.projector = await insertNamed('facilities', 'S130 Projector', facilityIds);
  id.sound = await insertNamed('facilities', 'S130 Sound system', facilityIds);
  id.whiteboard = await insertNamed('facilities', 'S130 Whiteboard', facilityIds);
  id.stepFree = await insertNamed('accessibility_features', 'S130 Step-free access', featureIds);
  id.hearingLoop = await insertNamed('accessibility_features', 'S130 Hearing loop', featureIds);

  venue.A = await addVenue('A', {
    locationId: id.bugis,
    maxCapacity: 150,
    layouts: [
      { layout: 'theatre', capacity: 120 },
      { layout: 'banquet', capacity: 80 },
    ],
    facilityIds: [id.projector, id.sound],
    accessibilityFeatureIds: [id.stepFree, id.hearingLoop],
  });
  venue.B = await addVenue('B', {
    locationId: id.jurong,
    maxCapacity: 100,
    layouts: [
      { layout: 'theatre', capacity: 100 },
      { layout: 'classroom', capacity: 100 },
    ],
    facilityIds: [id.projector],
    accessibilityFeatureIds: [id.stepFree],
  });
  venue.C = await addVenue('C', {
    locationId: id.marina,
    maxCapacity: 99,
    layouts: [{ layout: 'theatre', capacity: 99 }],
    facilityIds: [id.sound],
  });
  venue.D = await addVenue('D', {
    locationId: id.bugis,
    maxCapacity: 200,
    layouts: [{ layout: 'banquet', capacity: 200 }],
    facilityIds: [id.projector, id.sound, id.whiteboard],
    accessibilityFeatureIds: [id.stepFree, id.hearingLoop],
  });

  const { data: user, error: userError } = await admin.auth.admin.createUser({
    email: `organiser+s130${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (userError || !user.user) throw new Error(`could not create test organiser: ${userError?.message}`);
  organiserId = user.user.id;
});

afterAll(async () => {
  // Requests first (their bookings go with them), then the venues (their lists
  // go with them), then the maintained list entries, which venues restrict.
  if (requestIds.length > 0) await admin.from('event_request').delete().in('id', requestIds);
  for (const venueId of venueIds) await admin.from('venues').delete().eq('id', venueId);
  if (facilityIds.length > 0) await admin.from('facilities').delete().in('id', facilityIds);
  if (featureIds.length > 0) await admin.from('accessibility_features').delete().in('id', featureIds);
  if (locationIds.length > 0) await admin.from('locations').delete().in('id', locationIds);
  if (organiserId) await admin.auth.admin.deleteUser(organiserId);
});

describe('SCRUM-130 AC1: minimum capacity, no layout', () => {
  it('TC-130-01 min 100: A, B and D', async () => {
    expect(await found({ minCapacity: '100' })).toEqual(['A', 'B', 'D']);
  });

  it('TC-130-02 / TC-130-03 99 includes C at its maximum; 101 leaves out B at 100', async () => {
    expect(await found({ minCapacity: '99' })).toEqual(['A', 'B', 'C', 'D']);
    expect(await found({ minCapacity: '101' })).toEqual(['A', 'D']);
  });

  it('TC-130-04 an empty minimum applies no capacity filter', async () => {
    expect(await found({ minCapacity: '' })).toEqual(['A', 'B', 'C', 'D']);
  });

  it('TC-130-05 refuses 0, -5, abc and 10.5', async () => {
    for (const minCapacity of ['0', '-5', 'abc', '10.5']) {
      await expect(found({ minCapacity })).rejects.toThrow(ValidationError);
    }
  });
});

describe('SCRUM-130 AC2: minimum capacity with a layout', () => {
  it('TC-130-06 / TC-130-07 min 100 Theatre: A and B; not C (Theatre 99) or D (max 200, no Theatre)', async () => {
    expect(await found({ minCapacity: '100', layout: 'theatre' })).toEqual(['A', 'B']);
  });

  it('TC-130-08 Theatre 120 is in at min 120 and out at min 121, with its layout capacity shown', async () => {
    const result = await searchVenues({ date: DATE, start: '10:00', end: '12:00', minCapacity: '120', layout: 'theatre' });
    expect(result.venues.find((entry) => entry.id === venue.A)?.layoutCapacity).toBe(120);
    expect(await found({ minCapacity: '121', layout: 'theatre' })).toEqual([]);
  });
});

describe('SCRUM-130 AC3: a required layout', () => {
  it('TC-130-09 Theatre: A, B and C', async () => {
    expect(await found({ layout: 'theatre' })).toEqual(['A', 'B', 'C']);
  });

  it('TC-130-10 a layout none of them records returns none of them', async () => {
    expect(await found({ layout: 'cabaret' })).toEqual([]);
  });
});

describe('SCRUM-130 AC4: all of the selected facilities', () => {
  it('TC-130-11 Projector and Sound system: A and D', async () => {
    expect(await found({ facilityIds: [id.projector, id.sound] })).toEqual(['A', 'D']);
  });

  it('TC-130-12 Projector only: A, B and D', async () => {
    expect(await found({ facilityIds: [id.projector] })).toEqual(['A', 'B', 'D']);
  });

  it('TC-130-13 all three: only D', async () => {
    expect(await found({ facilityIds: [id.projector, id.sound, id.whiteboard] })).toEqual(['D']);
  });
});

describe('SCRUM-130 AC5, AC6: location', () => {
  it('TC-130-14 Bugis: A and D', async () => {
    expect(await found({ locationId: id.bugis })).toEqual(['A', 'D']);
  });

  it('TC-130-15 a location not on the maintained list is refused, not an empty result', async () => {
    await expect(found({ locationId: '99999999-9999-4999-8999-999999999999' })).rejects.toThrow(
      'Location must be chosen from the list.',
    );
  });

  it('TC-130-16 / TC-130-17 unset, or cleared, returns every location', async () => {
    expect(await found({})).toEqual(['A', 'B', 'C', 'D']);
    expect(await found({ locationId: '' })).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('SCRUM-130 AC7: all of the selected accessibility features', () => {
  it('TC-130-18 Step-free access: A, B and D', async () => {
    expect(await found({ accessibilityFeatureIds: [id.stepFree] })).toEqual(['A', 'B', 'D']);
  });

  it('TC-130-19 Step-free access and Hearing loop: A and D', async () => {
    expect(await found({ accessibilityFeatureIds: [id.stepFree, id.hearingLoop] })).toEqual(['A', 'D']);
  });

  it('TC-130-20 none selected: all four, C included', async () => {
    expect(await found({ accessibilityFeatureIds: [] })).toEqual(['A', 'B', 'C', 'D']);
  });

  it('TC-130-21 an unknown accessibility feature is refused', async () => {
    await expect(found({ accessibilityFeatureIds: ['99999999-9999-4999-8999-999999999999'] })).rejects.toThrow(
      ValidationError,
    );
  });
});

describe('SCRUM-130 AC1 to AC7 together, and with SCRUM-239 still applied', () => {
  it('TC-130-22 min 100, Theatre, Projector, Step-free access, Bugis: only A', async () => {
    expect(
      await found({
        minCapacity: '100',
        layout: 'theatre',
        facilityIds: [id.projector],
        accessibilityFeatureIds: [id.stepFree],
        locationId: id.bugis,
      }),
    ).toEqual(['A']);
  });

  it('TC-130-24 a confirmed booking still leaves out a venue that matches every filter', async () => {
    const { data, error } = await admin
      .from('event_request')
      .insert({
        organiser_id: organiserId,
        client_organisation_id: TEST_CLIENT_ORGANISATION_ID,
        name: `S130 Booking ${RUN}`,
        proposed_date: DATE,
        time_slots: ['am'],
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`could not create test request: ${error?.message}`);
    requestIds.push(data.id);
    await admin.from('event_request').update({ status: 'submitted' }).eq('id', data.id);
    const { error: bookError } = await admin.from('venue_booking').insert({
      venue_id: venue.A,
      event_request_id: data.id,
      date: DATE,
      slot: 'am',
      start_time: '10:00',
      end_time: '12:00',
    });
    if (bookError) throw new Error(`could not book test venue: ${bookError.message}`);

    expect(await found({ minCapacity: '100', locationId: id.bugis })).toEqual(['D']);
  });

  it('TC-130-25 an unavailable period still leaves out a venue that matches every filter', async () => {
    const { error } = await admin.from('venue_unavailable_slot').insert({
      venue_id: venue.D,
      date: DATE,
      slot: 'pm',
      reason: 'Annual maintenance',
      start_time: '14:00',
      end_time: '16:30',
    });
    if (error) throw new Error(`could not mark test venue unavailable: ${error.message}`);

    expect(await found({ locationId: id.bugis }, '15:00', '16:00')).toEqual(['A']);
  });

  it('TC-130-26 / TC-130-27 says whether filters were set, for the empty-result message', async () => {
    const filtered = await searchVenues({ date: DATE, start: '10:00', end: '12:00', minCapacity: '100000' });
    expect(filtered).toMatchObject({ filtered: true });
    expect(filtered.venues.filter((entry) => venueIds.includes(entry.id))).toEqual([]);
    expect(await searchVenues({ date: DATE, start: '02:00', end: '03:00' })).toMatchObject({ filtered: false });
  });
});
