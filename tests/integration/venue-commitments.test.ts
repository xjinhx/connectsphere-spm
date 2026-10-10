import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createVenue } from '@/domain/venues/service';
import { getCommittedPeriods, getVenueCommitments } from '@/domain/availability/service';
import { todayInSingapore } from '@/domain/shared/dates';
import { ensureTestClientOrganisation, TEST_CLIENT_ORGANISATION_ID } from './fixtures/clientOrganisation';

/**
 * SCRUM-239 Check venue availability in 15-minute time ranges (Jira,
 * authoritative): getVenueCommitments against the local Supabase stack, with
 * the time-model migration (20261008140500) applied. Test case IDs are from
 * ConnectSphere_TestCases_Sprint3_238_239_226.xlsx.
 *
 * Bookings and unavailable periods are written directly with their start and
 * end times, as the later SCRUM-239 changes to approval and SCRUM-151 will
 * write them. One booking is written the old way, with only a slot, to check
 * the migration's trigger still gives it its times (AC7).
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

let locationId: string;
let organiserId: string;
const venueIds: string[] = [];
const requestIds: string[] = [];

function daysFromToday(days: number): string {
  const date = new Date(`${todayInSingapore()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createTestVenue(label: string) {
  const venue = await createVenue({
    name: `${label} ${RUN}`,
    locationId,
    maxCapacity: 100,
    operatingSlots: ['am', 'pm', 'night'],
  });
  venueIds.push(venue.id);
  return venue;
}

async function createEvent(date: string): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: TEST_CLIENT_ORGANISATION_ID,
      name: `Commitments Event ${RUN}`,
      proposed_date: date,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test request: ${error?.message}`);
  requestIds.push(data.id);
  return data.id;
}

/**
 * A confirmed booking. `slot` is still a required column until the slot
 * columns are dropped; with explicit times the trigger leaves them alone.
 */
async function book(venueId: string, date: string, slot: string, times?: { start: string; end: string }) {
  const eventId = await createEvent(date);
  const { error } = await admin.from('venue_booking').insert({
    venue_id: venueId,
    event_request_id: eventId,
    date,
    slot,
    ...(times && { start_time: times.start, end_time: times.end }),
  });
  if (error) throw new Error(`could not book: ${error.message}`);
  return eventId;
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  const { data: location, error } = await admin
    .from('locations')
    .insert({ name: `Commitments Location ${RUN}` })
    .select('id')
    .single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;

  const { data: user, error: userError } = await admin.auth.admin.createUser({
    email: `organiser+commitments${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (userError || !user.user) throw new Error(`could not create organiser: ${userError?.message}`);
  organiserId = user.user.id;
});

afterAll(async () => {
  for (const id of requestIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of venueIds) await admin.from('venues').delete().eq('id', id);
  if (organiserId) await admin.auth.admin.deleteUser(organiserId);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
});

describe('getVenueCommitments against the database (SCRUM-239)', () => {
  it('TC-239-05, 06, 07: a confirmed 10:00-12:00 booking clashes only with ranges that overlap it', async () => {
    const venue = await createTestVenue('Venue A');
    const date = daysFromToday(30);
    const eventId = await book(venue.id, date, 'am', { start: '10:00', end: '12:00' });

    expect(await getVenueCommitments(venue.id, `${date}T09:00`, `${date}T13:00`)).toEqual([
      { kind: 'booking', venueId: venue.id, date, start: '10:00', end: '12:00', eventRequestId: eventId, reason: null },
    ]);
    expect(await getVenueCommitments(venue.id, `${date}T12:00`, `${date}T14:00`)).toEqual([]);
    expect(await getVenueCommitments(venue.id, `${date}T11:45`, `${date}T13:00`)).toHaveLength(1);
    expect(await getVenueCommitments(venue.id, `${date}T08:00`, `${date}T10:00`)).toEqual([]);
  });

  it('TC-239-25, 26: an unavailable 14:00-16:30 period is returned with its reason, and ends at 16:30', async () => {
    const venue = await createTestVenue('Venue B');
    const date = daysFromToday(31);
    const { error } = await admin.from('venue_unavailable_slot').insert({
      venue_id: venue.id,
      date,
      slot: 'pm',
      start_time: '14:00',
      end_time: '16:30',
      reason: 'Ceiling repair',
    });
    if (error) throw new Error(`could not mark unavailable: ${error.message}`);

    expect(await getVenueCommitments(venue.id, `${date}T15:00`, `${date}T16:00`)).toEqual([
      { kind: 'unavailable', venueId: venue.id, date, start: '14:00', end: '16:30', eventRequestId: null, reason: 'Ceiling repair' },
    ]);
    expect(await getVenueCommitments(venue.id, `${date}T16:30`, `${date}T18:00`)).toEqual([]);
  });

  it('TC-239-15, 16: a booking written the old way, with only a slot, gets its times and still clashes', async () => {
    const venue = await createTestVenue('Venue C');
    const date = daysFromToday(32);
    await book(venue.id, date, 'night');

    const [period] = await getVenueCommitments(venue.id, `${date}T20:00`, `${date}T21:00`);
    expect(period).toMatchObject({ kind: 'booking', start: '19:00', end: '24:00' });
  });

  it("does not return another venue's bookings or another date's", async () => {
    const venue = await createTestVenue('Venue D');
    const other = await createTestVenue('Venue E');
    const date = daysFromToday(33);
    await book(other.id, date, 'am', { start: '10:00', end: '12:00' });
    await book(venue.id, daysFromToday(34), 'am', { start: '10:00', end: '12:00' });

    expect(await getVenueCommitments(venue.id, `${date}T08:00`, `${date}T22:00`)).toEqual([]);
  });

  it('returns several dates in order across a multi-day range', async () => {
    const venue = await createTestVenue('Venue F');
    const first = daysFromToday(40);
    const second = daysFromToday(41);
    await book(venue.id, second, 'am', { start: '09:00', end: '10:00' });
    await book(venue.id, first, 'pm', { start: '15:00', end: '16:00' });

    const result = await getVenueCommitments(venue.id, `${first}T00:00`, `${second}T24:00`);
    expect(result.map((c) => `${c.date} ${c.start}`)).toEqual([`${first} 15:00`, `${second} 09:00`]);
  });
});

describe('getVenueCommitments against the database: SCRUM-226 setup and turnaround', () => {
  /** The card's venue: 30 min setup, 45 min turnaround (set directly until SCRUM-225's form exists). */
  async function createCardVenue(label: string) {
    const venue = await createTestVenue(label);
    const { error } = await admin
      .from('venues')
      .update({ setup_minutes: 30, turnaround_minutes: 45 })
      .eq('id', venue.id);
    if (error) throw new Error(`could not set setup and turnaround: ${error.message}`);
    return venue;
  }

  it('TC-226-01..05: a confirmed 10:00-12:00 booking occupies 09:30-12:45', async () => {
    const venue = await createCardVenue('Venue V');
    const date = daysFromToday(50);
    const eventId = await book(venue.id, date, 'am', { start: '10:00', end: '12:00' });

    // AC4: the calendar's committed block includes setup and turnaround.
    expect(await getCommittedPeriods(venue.id, `${date}T00:00`, `${date}T24:00`)).toEqual([
      { date, start: '09:30', end: '12:45' },
    ]);
    // AC1-AC3: 12:30-14:00 clashes, and Venue Staff see which booking.
    expect(await getVenueCommitments(venue.id, `${date}T12:30`, `${date}T14:00`)).toEqual([
      { kind: 'booking', venueId: venue.id, date, start: '09:30', end: '12:45', eventRequestId: eventId, reason: null },
    ]);
  });

  it('TC-226-07..10 (AC5): 13:15 is free, 13:00 is not', async () => {
    const venue = await createCardVenue('Venue V5');
    const date = daysFromToday(51);
    await book(venue.id, date, 'am', { start: '10:00', end: '12:00' });

    expect(await getVenueCommitments(venue.id, `${date}T13:15`, `${date}T14:30`)).toEqual([]);
    expect(await getVenueCommitments(venue.id, `${date}T13:00`, `${date}T14:30`)).toHaveLength(1);
  });
});
