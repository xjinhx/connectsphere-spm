import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createVenue } from '@/domain/venues/service';
import {
  findUnavailableSlots,
  listUpcomingUnavailableSlots,
  markSlotsUnavailable,
} from '@/domain/availability/service';
import { todayInSingapore } from '@/domain/shared/dates';

/**
 * SCRUM-151 Withdraw venue availability when circumstances change: AC1.
 *
 * AC1 (Jira, authoritative): "Given I select a venue, a date and the affected
 * slots and record a reason, when I save, then those slots are recorded as
 * unavailable and are no longer offered for new bookings."
 *
 * "No longer offered" has no booking request or search to run through yet
 * (SCRUM-142, 154, 128 are this sprint's). What those stories will ask is
 * findUnavailableSlots, so that is tested directly here, and the check is
 * re-run end to end once they call it.
 *
 * Runs against the local Supabase stack: the unique constraint is what makes
 * a save with a slot already unavailable save nothing at all. The admin client
 * only arranges and reads rows.
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

let locationId: string;
let venueStaffId: string;
const venueIds: string[] = [];

/** The Singapore date `days` from today, as YYYY-MM-DD. */
function daysFromToday(days: number): string {
  const date = new Date(`${todayInSingapore()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A venue of this file's own. It operates AM and PM only, so Night can be refused. */
async function createTestVenue(label: string) {
  const venue = await createVenue({ name: `${label} ${RUN}`, locationId, maxCapacity: 100, operatingSlots: ['am', 'pm'] });
  venueIds.push(venue.id);
  return venue;
}

async function rowsFor(venueId: string) {
  const { data, error } = await admin
    .from('venue_unavailable_slot')
    .select('slot_date, slot, reason, recorded_by')
    .eq('venue_id', venueId);
  if (error || !data) throw new Error(`could not read unavailable slots: ${error?.message}`);
  return data;
}

beforeAll(async () => {
  const { data: location, error } = await admin
    .from('locations')
    .insert({ name: `Unavailable Slots Location ${RUN}` })
    .select('id')
    .single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;

  const { data: user, error: userError } = await admin.auth.admin.createUser({
    email: `venue-staff+unavailable${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (userError || !user.user) throw new Error(`could not create test venue staff: ${userError?.message}`);
  venueStaffId = user.user.id;
});

afterAll(async () => {
  // Venues first: their unavailable slots go with them (cascade), and
  // recorded_by is ON DELETE RESTRICT, so the account can only go after.
  for (const id of venueIds) {
    await admin.from('venues').delete().eq('id', id);
  }
  if (venueStaffId) await admin.auth.admin.deleteUser(venueStaffId);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
});

describe('markSlotsUnavailable (SCRUM-151 AC1)', () => {
  it('records each ticked slot as its own unavailable slot, with the reason and who recorded it', async () => {
    const venue = await createTestVenue('Hall A');
    const date = daysFromToday(5);

    const saved = await markSlotsUnavailable(
      venue.id,
      { date, slots: ['pm', 'am'], reason: '  Ceiling repair ' },
      venueStaffId,
    );

    expect(saved.map((entry) => entry.slot)).toEqual(['am', 'pm']);
    const rows = await rowsFor(venue.id);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({ slot_date: date, reason: 'Ceiling repair', recorded_by: venueStaffId });
    }
  });

  it('refuses a save that includes a slot already unavailable, names it, and saves none of the others', async () => {
    const venue = await createTestVenue('Hall B');
    const date = daysFromToday(5);
    await markSlotsUnavailable(venue.id, { date, slots: ['am'], reason: 'Power outage' }, venueStaffId);

    await expect(
      markSlotsUnavailable(venue.id, { date, slots: ['am', 'pm'], reason: 'Ceiling repair' }, venueStaffId),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('AM on'),
      details: { reason: 'already_unavailable' },
    });

    // PM was not saved, and AM still carries its first reason.
    const rows = await rowsFor(venue.id);
    expect(rows).toEqual([expect.objectContaining({ slot: 'am', reason: 'Power outage' })]);
  });

  it('refuses a slot the venue does not operate, and saves nothing', async () => {
    const venue = await createTestVenue('Hall C');

    await expect(
      markSlotsUnavailable(venue.id, { date: daysFromToday(5), slots: ['pm', 'night'], reason: 'Flooding' }, venueStaffId),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('Night') });
    expect(await rowsFor(venue.id)).toEqual([]);
  });

  it('refuses a blank reason before writing anything', async () => {
    const venue = await createTestVenue('Hall D');

    await expect(
      markSlotsUnavailable(venue.id, { date: daysFromToday(5), slots: ['am'], reason: '   ' }, venueStaffId),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'A reason is required.' });
    expect(await rowsFor(venue.id)).toEqual([]);
  });

  it('reports an unknown venue as not found', async () => {
    await expect(
      markSlotsUnavailable(
        '99999999-9999-4999-8999-999999999999',
        { date: daysFromToday(5), slots: ['am'], reason: 'Ceiling repair' },
        venueStaffId,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('findUnavailableSlots: the check other stories ask (SCRUM-151 AC1, "no longer offered")', () => {
  it('answers which slots are unavailable on a date, each with its recorded reason', async () => {
    const venue = await createTestVenue('Hall E');
    const date = daysFromToday(7);
    await markSlotsUnavailable(venue.id, { date, slots: ['am'], reason: 'Ceiling repair' }, venueStaffId);

    const unavailable = await findUnavailableSlots(venue.id, date, ['am', 'pm']);
    expect(unavailable.map(({ slot, reason }) => ({ slot, reason }))).toEqual([
      { slot: 'am', reason: 'Ceiling repair' },
    ]);
  });

  it('finds nothing for a slot that was not withdrawn, or on another date', async () => {
    const venue = await createTestVenue('Hall F');
    const date = daysFromToday(7);
    await markSlotsUnavailable(venue.id, { date, slots: ['am'], reason: 'Ceiling repair' }, venueStaffId);

    expect(await findUnavailableSlots(venue.id, date, ['pm'])).toEqual([]);
    expect(await findUnavailableSlots(venue.id, daysFromToday(8))).toEqual([]);
  });
});

describe('listUpcomingUnavailableSlots: the venue page list (SCRUM-151 AC1)', () => {
  it('lists today and later only, soonest first, and AM before PM within a day', async () => {
    const venue = await createTestVenue('Hall G');
    await markSlotsUnavailable(venue.id, { date: daysFromToday(-1), slots: ['am'], reason: 'Yesterday' }, venueStaffId);
    await markSlotsUnavailable(venue.id, { date: daysFromToday(3), slots: ['pm', 'am'], reason: 'Later' }, venueStaffId);
    await markSlotsUnavailable(venue.id, { date: daysFromToday(1), slots: ['pm'], reason: 'Sooner' }, venueStaffId);

    const listed = await listUpcomingUnavailableSlots(venue.id);
    expect(listed.map(({ date, slot }) => `${date} ${slot}`)).toEqual([
      `${daysFromToday(1)} pm`,
      `${daysFromToday(3)} am`,
      `${daysFromToday(3)} pm`,
    ]);
  });
});
