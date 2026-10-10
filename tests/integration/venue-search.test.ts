import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createVenue, searchVenues } from '@/domain/venues/service';
import { todayInSingapore } from '@/domain/shared/dates';
import type { OperatingSlot } from '@/domain/venues/schema';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-239 venue search in exact time ranges (AC2), unavailable periods (AC8's
 * search half), and AC1's "search does not return that venue" outside its
 * opening hours, against Postgres.
 * Replaces SCRUM-128's slot search; its AC2 to AC5 still hold, in time ranges.
 *
 * AC2 (Jira): a confirmed booking 10:00-12:00: a 12:00-14:00 search returns
 *     the venue, an 11:45-13:00 search does not.
 *
 * Bookings (venue_booking) and unavailable periods (venue_unavailable_slot)
 * are written directly with their times. `slot` is still a required column
 * until the slot columns are dropped (Dylan's #89 follow-up), so each row
 * carries the slot it falls in; one row per slot per venue and date, as the
 * per-slot unique index still requires.
 *
 * Every test uses venues of its own and checks only those, because the search
 * reads the whole catalogue and other files add venues and bookings too.
 * Test case IDs: TC-239-xx from ConnectSphere_TestCases_Sprint3_238_239_226.xlsx;
 * TC-128-xx are SCRUM-128's, kept as regression checks.
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let locationId: string;
let organiserId: string;
const venueIds: string[] = [];
const requestIds: string[] = [];

/** The Singapore date `days` from today, as YYYY-MM-DD. */
function daysFromToday(days: number): string {
  const date = new Date(`${todayInSingapore()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const DATE = daysFromToday(60);

async function createTestVenue(label: string, operatingSlots: OperatingSlot[] = ['am', 'pm', 'night']) {
  const venue = await createVenue({ name: `Search ${label} ${RUN}`, locationId, maxCapacity: 100, operatingSlots });
  venueIds.push(venue.id);
  return venue.id;
}

type Period = { slot: OperatingSlot; start?: string; end?: string };

/** A confirmed booking of each period on `date`, for a submitted event request. Without times, the slot's times apply. */
async function book(venueId: string, periods: Period[], date = DATE) {
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: CLIENT_ORGANISATION_ID,
      name: `Venue Search Event ${RUN}`,
      proposed_date: date,
      time_slots: periods.map((p) => p.slot),
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test request: ${error?.message}`);
  requestIds.push(data.id);

  const { error: submitError } = await admin.from('event_request').update({ status: 'submitted' }).eq('id', data.id);
  if (submitError) throw new Error(`could not submit test request: ${submitError.message}`);

  const { error: bookError } = await admin
    .from('venue_booking')
    .insert(
      periods.map(({ slot, start, end }) => ({
        venue_id: venueId,
        event_request_id: data.id,
        date,
        slot,
        ...(start && end && { start_time: start, end_time: end }),
      })),
    );
  if (bookError) throw new Error(`could not book test request: ${bookError.message}`);
}

/** Venue Staff have withdrawn this period, with a reason. Without times, the slot's times apply. */
async function markUnavailable(venueId: string, { slot, start, end }: Period, date = DATE) {
  const { error } = await admin.from('venue_unavailable_slot').insert({
    venue_id: venueId,
    date,
    slot,
    reason: 'Annual maintenance',
    ...(start && end && { start_time: start, end_time: end }),
  });
  if (error) throw new Error(`could not record unavailable slot: ${error.message}`);
}

/** The ids the search returned for start-end on `date`. */
async function found(start: string, end: string, date = DATE): Promise<string[]> {
  const result = await searchVenues({ date, start, end });
  return result.venues.map((venue) => venue.id);
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  const { data, error } = await admin.from('locations').insert({ name: `Venue Search Location ${RUN}` }).select('id').single();
  if (error || !data) throw new Error(`could not create test location: ${error?.message}`);
  locationId = data.id;

  const { data: user, error: userError } = await admin.auth.admin.createUser({
    email: `organiser+search${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (userError || !user.user) throw new Error(`could not create test organiser: ${userError?.message}`);
  organiserId = user.user.id;
});

afterAll(async () => {
  // Requests first: their bookings cascade with them, and a venue with a
  // booking cannot be deleted. Unavailable slots cascade with their venue.
  if (requestIds.length > 0) await admin.from('event_request').delete().in('id', requestIds);
  for (const id of venueIds) await admin.from('venues').delete().eq('id', id);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
  if (organiserId) await admin.auth.admin.deleteUser(organiserId);
});

describe('searchVenues: SCRUM-239 AC2, exact time ranges', () => {
  it('TC-239-05, 06, 07: a confirmed 10:00-12:00 booking excludes only searches that overlap it', async () => {
    const venue = await createTestVenue('Booked ten to twelve');
    await book(venue, [{ slot: 'am', start: '10:00', end: '12:00' }]);
    expect(await found('12:00', '14:00')).toContain(venue);
    expect(await found('11:45', '13:00')).not.toContain(venue);
    expect(await found('08:00', '10:00')).toContain(venue);
  });

  it('a search spanning the whole booking excludes the venue', async () => {
    const venue = await createTestVenue('Booked inside search');
    await book(venue, [{ slot: 'pm', start: '14:00', end: '15:00' }]);
    expect(await found('13:00', '18:00')).not.toContain(venue);
  });

  it('TC-128-06: a booking on another date does not exclude the venue', async () => {
    const venue = await createTestVenue('Booked day before');
    await book(venue, [{ slot: 'pm', start: '14:00', end: '16:00' }], daysFromToday(59));
    expect(await found('14:00', '16:00')).toContain(venue);
  });

  it('TC-239-16: a booking made under the slot model (PM, no times written) still excludes 13:00-18:00 searches', async () => {
    const venue = await createTestVenue('Legacy PM booking');
    await book(venue, [{ slot: 'pm' }]);
    expect(await found('15:00', '16:00')).not.toContain(venue);
    expect(await found('18:00', '19:00')).toContain(venue);
  });

  it('a free venue is returned', async () => {
    const venue = await createTestVenue('Free all day');
    expect(await found('09:15', '17:45')).toContain(venue);
  });
});

describe('searchVenues: SCRUM-239 AC1, opening hours', () => {
  it('TC-239-04: a venue open 07:00-18:00 (AM and PM) is not returned for a period past 18:00', async () => {
    const venue = await createTestVenue('Day only', ['am', 'pm']);
    expect(await found('17:00', '19:00')).not.toContain(venue);
    expect(await found('21:00', '23:00')).not.toContain(venue);
    expect(await found('07:00', '18:00')).toContain(venue);
  });

  it('a venue open until 24:00 is returned for 22:00-24:00', async () => {
    const venue = await createTestVenue('Open late');
    expect(await found('22:00', '24:00')).toContain(venue);
  });

  it('TC-128-09: a retired venue is not returned, the same default as the catalogue', async () => {
    const venue = await createTestVenue('Retired');
    const { error } = await admin.from('venues').update({ is_retired: true }).eq('id', venue);
    if (error) throw new Error(`could not retire test venue: ${error.message}`);
    expect(await found('09:00', '10:00')).not.toContain(venue);
  });
});

describe('searchVenues: SCRUM-239 AC8, unavailable periods', () => {
  it('TC-239-20 (AC8): an unavailable 14:00-16:30 period excludes an overlapping search, not one starting at 16:30', async () => {
    const venue = await createTestVenue('Unavailable afternoon');
    await markUnavailable(venue, { slot: 'pm', start: '14:00', end: '16:30' });
    expect(await found('15:00', '16:00')).not.toContain(venue);
    expect(await found('16:30', '18:00')).toContain(venue);
  });

  it('TC-128-13, 14: a Night slot recorded the old way excludes a night search, not a morning one', async () => {
    const venue = await createTestVenue('Night unavailable');
    await markUnavailable(venue, { slot: 'night' });
    expect(await found('20:00', '21:00')).not.toContain(venue);
    expect(await found('09:00', '10:00')).toContain(venue);
  });
});

describe('searchVenues: SCRUM-128 AC5 still holds, no booking horizon', () => {
  it('TC-128-15: returns results for a date five years from today', async () => {
    const venue = await createTestVenue('Five years ahead');
    const date = daysFromToday(5 * 365 + 1);
    const result = await searchVenues({ date, start: '09:00', end: '10:00' });
    expect(result.date).toBe(date);
    expect(result.venues.map((v) => v.id)).toContain(venue);
  });

  it("TC-128-16: returns results for today's date", async () => {
    const venue = await createTestVenue('Today');
    expect(await found('14:00', '15:00', todayInSingapore())).toContain(venue);
  });
});

describe('searchVenues: input', () => {
  it('refuses a time off the 15-minute step, and an end not after the start', async () => {
    await expect(searchVenues({ date: DATE, start: '10:10', end: '12:00' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(searchVenues({ date: DATE, start: '14:00', end: '13:00' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});
