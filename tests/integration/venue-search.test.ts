import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createVenue, searchVenues } from '@/domain/venues/service';
import { todayInSingapore } from '@/domain/shared/dates';
import type { OperatingSlot } from '@/domain/venues/schema';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-128 Search venues by date and slot: AC1 to AC5, against Postgres.
 *
 * AC1 "... a venue is returned only if it is free in every one of the selected
 *     slots, and is excluded if it is committed in any one of them."
 * AC2 a confirmed PM booking excludes the venue from a PM search.
 * AC3 a confirmed AM booking does not exclude it from a PM-only search.
 * AC4 a Night slot recorded as unavailable excludes it from a Night search.
 * AC5 a date 5 years ahead returns results: no booking horizon.
 *
 * Bookings are stand-in D-04 (venue_booking, dated by its event request) and
 * unavailable slots are stand-in D-09 (venue_unavailable_slot). Both are added
 * by hand here, as a tester would. See docs/dummies.md.
 *
 * Every test uses venues of its own and checks only those, because the search
 * reads the whole catalogue and other files add venues and bookings too.
 *
 * Test case IDs are from Self_Owned_ScrumsTest.xlsx, sheet SCRUM-128.
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

/** D-04: a confirmed booking takes its date and slots from its event request. */
async function book(venueId: string, slots: OperatingSlot[], date = DATE) {
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: CLIENT_ORGANISATION_ID,
      name: `Venue Search Event ${RUN}`,
      proposed_date: date,
      time_slots: slots,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test request: ${error?.message}`);
  requestIds.push(data.id);

  const { error: submitError } = await admin.from('event_request').update({ status: 'submitted' }).eq('id', data.id);
  if (submitError) throw new Error(`could not submit test request: ${submitError.message}`);

  const { error: bookError } = await admin.from('venue_booking').insert({ venue_id: venueId, event_request_id: data.id });
  if (bookError) throw new Error(`could not book test request: ${bookError.message}`);
}

/** D-09: Venue Staff have withdrawn this slot, with a reason. */
async function markUnavailable(venueId: string, slot: OperatingSlot, date = DATE) {
  const { error } = await admin
    .from('venue_unavailable_slot')
    .insert({ venue_id: venueId, date, slot, reason: 'Annual maintenance' });
  if (error) throw new Error(`could not record unavailable slot: ${error.message}`);
}

/** The ids the search returned for `slots` on `date`. */
async function found(slots: OperatingSlot[], date = DATE): Promise<string[]> {
  const result = await searchVenues({ date, slots });
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

describe('searchVenues: SCRUM-128 AC1, free in every selected slot', () => {
  it('TC-128-01 returns a venue free in the one selected slot', async () => {
    const venue = await createTestVenue('Free AM');
    expect(await found(['am'])).toContain(venue);
  });

  it('TC-128-02 returns a venue free in both selected slots', async () => {
    const venue = await createTestVenue('Free AM PM');
    expect(await found(['am', 'pm'])).toContain(venue);
  });

  it('TC-128-03 excludes a venue committed in one of the selected slots', async () => {
    const venue = await createTestVenue('Booked PM of two');
    await book(venue, ['pm']);
    expect(await found(['am', 'pm'])).not.toContain(venue);
  });

  it('TC-128-09 returns a venue free in all three slots', async () => {
    const venue = await createTestVenue('Free all day');
    expect(await found(['am', 'pm', 'night'])).toContain(venue);
  });

  it('TC-128-10 excludes a venue committed in exactly one of three selected slots', async () => {
    const venue = await createTestVenue('Booked Night of three');
    await book(venue, ['night']);
    expect(await found(['am', 'pm', 'night'])).not.toContain(venue);
  });

  it('an event over two slots commits both of them', async () => {
    const venue = await createTestVenue('Booked AM and PM');
    await book(venue, ['am', 'pm']);
    expect(await found(['pm'])).not.toContain(venue);
    expect(await found(['night'])).toContain(venue);
  });

  it('TC-128-12 a booking on another date does not exclude the venue', async () => {
    const venue = await createTestVenue('Booked day before');
    await book(venue, ['pm'], daysFromToday(59));
    expect(await found(['pm'])).toContain(venue);
  });

  it('excludes a venue that does not operate a selected slot', async () => {
    const venue = await createTestVenue('Closed at night', ['am', 'pm']);
    expect(await found(['night'])).not.toContain(venue);
    expect(await found(['am'])).toContain(venue);
  });

  it('excludes a retired venue, the same default as the catalogue', async () => {
    const venue = await createTestVenue('Retired');
    const { error } = await admin.from('venues').update({ is_retired: true }).eq('id', venue);
    if (error) throw new Error(`could not retire test venue: ${error.message}`);
    expect(await found(['am'])).not.toContain(venue);
  });

  it('TC-128-13 refuses a search with no slot selected', async () => {
    await expect(searchVenues({ date: DATE, slots: [] })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { fieldErrors: { slots: ['Select at least one slot.'] } },
    });
  });
});

describe('searchVenues: SCRUM-128 AC2 and AC3, confirmed bookings', () => {
  it('TC-128-04 excludes a venue with a confirmed booking in the searched slot (AC2)', async () => {
    const venue = await createTestVenue('Booked PM');
    await book(venue, ['pm']);
    expect(await found(['pm'])).not.toContain(venue);
  });

  it('TC-128-05 returns a venue whose confirmed booking is in another slot (AC3)', async () => {
    const venue = await createTestVenue('Booked AM');
    await book(venue, ['am']);
    expect(await found(['pm'])).toContain(venue);
    // The booking is real: the same venue is excluded from an AM search.
    expect(await found(['am'])).not.toContain(venue);
  });
});

describe('searchVenues: SCRUM-128 AC4, a slot recorded as unavailable', () => {
  it('TC-128-06 excludes a venue whose searched Night slot is unavailable (AC4)', async () => {
    const venue = await createTestVenue('Night unavailable');
    await markUnavailable(venue, 'night');
    expect(await found(['night'])).not.toContain(venue);
  });

  it('TC-128-07 returns the same venue for a slot that is not affected (AC1, AC4)', async () => {
    const venue = await createTestVenue('Night unavailable, AM free');
    await markUnavailable(venue, 'night');
    expect(await found(['am'])).toContain(venue);
  });
});

describe('searchVenues: SCRUM-128 AC5, no booking horizon', () => {
  it('TC-128-08 returns results for a date five years from today (AC5)', async () => {
    const venue = await createTestVenue('Five years ahead');
    const date = daysFromToday(5 * 365 + 1);
    const result = await searchVenues({ date, slots: ['am'] });
    expect(result.date).toBe(date);
    expect(result.venues.map((v) => v.id)).toContain(venue);
  });

  it("TC-128-11 returns results for today's date", async () => {
    const venue = await createTestVenue('Today');
    expect(await found(['pm'], todayInSingapore())).toContain(venue);
  });
});
