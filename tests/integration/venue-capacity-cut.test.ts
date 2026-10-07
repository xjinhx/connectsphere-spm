import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { saveVenueChanges } from '@/lib/supabase/venues';
import { createVenue, getVenue, updateVenue } from '@/domain/venues/service';
import { todayInSingapore } from '@/domain/shared/dates';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-120 Update venue information: AC2, AC3 and AC4.
 *
 * AC2: "Given a venue has a confirmed future booking whose expected attendance
 *      is 100 and I set the venue's maximum capacity to 99, when I save, then
 *      that booking is shown to me and I must confirm before the change is
 *      applied."
 * AC3: "... I set the venue's maximum capacity to 100, when I save, then the
 *      change is applied with no warning."
 * AC4: "Given I confirm a capacity reduction that affects a future booking,
 *      when the change is applied, then the Event Coordinator assigned to each
 *      affected event is notified."
 *
 * Bookings are venue_booking rows, one per venue, date and slot. In the app
 * SCRUM-148's approval writes them (D-04, replaced); here they are added
 * directly as setup. The notification is stand-in D-05 (a
 * venue_capacity_notice row). See docs/dummies.md.
 *
 * Test cases: US-11.4-TC02 (AC2), US-11.4-TC03 (AC3), US-11.4-TC04 (AC4).
 *
 * "Future" is a Singapore date (todayInSingapore), never the server's UTC one:
 * until 08:00 in Singapore, UTC is still on yesterday.
 *
 * Runs against the local Supabase stack. Postgres is the point: update_venue
 * repeats the check inside the save and writes the notices in the same
 * transaction as the cut. The admin client only arranges and reads rows.
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let locationId: string;
let organiserId: string;
let coordinatorId: string;
const venueIds: string[] = [];
const requestIds: string[] = [];

/** The Singapore date `days` from today, as the YYYY-MM-DD the database compares. */
function daysFromToday(days: number): string {
  const date = new Date(`${todayInSingapore()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A venue of this file's own, with no layouts so a cut is never refused by SCRUM-118. */
async function createTestVenue(label: string, maxCapacity = 200) {
  const venue = await createVenue({ name: `${label} ${RUN}`, locationId, maxCapacity });
  venueIds.push(venue.id);
  return venue;
}

/**
 * A confirmed booking of a submitted event into the venue. The assignment is
 * an update after the submission: event_request_assignment_needs_submission
 * refuses a coordinator on a draft.
 */
async function bookEvent(
  venueId: string,
  { attendance, date = daysFromToday(30), coordinator = null }: { attendance: number; date?: string; coordinator?: string | null },
): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: CLIENT_ORGANISATION_ID,
      name: `Capacity Cut Event ${RUN}`,
      expected_attendance: attendance,
      proposed_date: date,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test request: ${error?.message}`);
  const id = data.id;
  requestIds.push(id);

  const { error: submitError } = await admin.from('event_request').update({ status: 'submitted' }).eq('id', id);
  if (submitError) throw new Error(`could not submit test request: ${submitError.message}`);

  if (coordinator) {
    const { error: assignError } = await admin
      .from('event_request')
      .update({ coordinator_id: coordinator, assigned_by: coordinator })
      .eq('id', id);
    if (assignError) throw new Error(`could not assign test request: ${assignError.message}`);
  }

  // One slot per booking, rotated so events sharing a venue and date never
  // claim the same slot (venue_booking_one_per_slot, SCRUM-148).
  const slot = SLOTS[bookingCount++ % SLOTS.length];
  const { error: bookError } = await admin
    .from('venue_booking')
    .insert({ venue_id: venueId, event_request_id: id, date, slot });
  if (bookError) throw new Error(`could not book test request: ${bookError.message}`);
  return id;
}

const SLOTS = ['am', 'pm', 'night'];
let bookingCount = 0;

async function noticesFor(venueId: string) {
  const { data, error } = await admin
    .from('venue_capacity_notice')
    .select('event_request_id, coordinator_id, previous_capacity, new_capacity, expected_attendance')
    .eq('venue_id', venueId);
  if (error || !data) throw new Error(`could not read notices: ${error?.message}`);
  return data;
}

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+capacity${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user returned'}`);
  return data.user.id;
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  const { data, error } = await admin.from('locations').insert({ name: `Capacity Cut Location ${RUN}` }).select('id').single();
  if (error || !data) throw new Error(`could not create test location: ${error?.message}`);
  locationId = data.id;
  organiserId = await createUser('organiser');
  coordinatorId = await createUser('coordinator');
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  // Requests first: their bookings and notices cascade with them, a venue with
  // a booking cannot be deleted, and coordinator_id is ON DELETE RESTRICT.
  if (requestIds.length > 0) await admin.from('event_request').delete().in('id', requestIds);
  for (const id of venueIds) await admin.from('venues').delete().eq('id', id);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
  if (coordinatorId) await admin.auth.admin.deleteUser(coordinatorId);
  if (organiserId) await admin.auth.admin.deleteUser(organiserId);
});

describe('updateVenue: SCRUM-120 AC2, a cut below a confirmed future booking', () => {
  it('US-11.4-TC02 SCRUM-120 AC2 shows the affected booking and saves nothing until confirmed', async () => {
    const venue = await createTestVenue('Cut Refused');
    const eventId = await bookEvent(venue.id, { attendance: 100, coordinator: coordinatorId });

    await expect(updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, maxCapacity: 99 })).rejects.toMatchObject({
      code: 'CONFLICT',
      details: {
        reason: 'affected_bookings',
        maxCapacity: 99,
        bookings: [{ eventId, expectedAttendance: 100, coordinatorId }],
      },
    });

    expect((await getVenue(venue.id)).maxCapacity).toBe(200);
    expect(await noticesFor(venue.id)).toEqual([]);
  });

  it('US-11.4-TC02 SCRUM-120 AC2 applies the cut once the editor confirms it', async () => {
    const venue = await createTestVenue('Cut Confirmed');
    await bookEvent(venue.id, { attendance: 100, coordinator: coordinatorId });

    const saved = await updateVenue(venue.id, {
      expectedUpdatedAt: venue.updatedAt,
      maxCapacity: 99,
      confirmAffectedBookings: true,
    });

    expect(saved.maxCapacity).toBe(99);
  });

  // The service checks first to show the list, but a booking can be confirmed
  // between that check and the save. update_venue checks again under the
  // venue lock, so calling it directly with no confirmation is still refused.
  it('refuses an unconfirmed cut inside the save itself, writing nothing', async () => {
    const venue = await createTestVenue('Cut In Save');
    await bookEvent(venue.id, { attendance: 100, coordinator: coordinatorId });

    const { data: outcome, error } = await saveVenueChanges(venue.id, venue.updatedAt, { maxCapacity: 99 });

    expect(error).toBeNull();
    expect(outcome).toBe('affected_bookings');
    const after = await getVenue(venue.id);
    expect(after.maxCapacity).toBe(200);
    expect(after.updatedAt).toBe(venue.updatedAt);
    expect(await noticesFor(venue.id)).toEqual([]);
  });

  it('ignores a booking for an event that has already taken place', async () => {
    const venue = await createTestVenue('Cut Past Booking');
    await bookEvent(venue.id, { attendance: 150, date: daysFromToday(-1), coordinator: coordinatorId });

    const saved = await updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, maxCapacity: 99 });

    expect(saved.maxCapacity).toBe(99);
    expect(await noticesFor(venue.id)).toEqual([]);
  });

  // Raised in review of PR #61. At 02:00 in Singapore the UTC date is still
  // yesterday, so a UTC "today" counted yesterday's event as a future booking:
  // the editor was asked to confirm and a notice was stored for an event that
  // had already happened. Only Date is faked; the database clock is real, which
  // is why the service hands update_venue the date it decided on.
  it('at 02:00 in Singapore, does not count an event dated yesterday as a future booking', async () => {
    const today = todayInSingapore();
    const yesterday = daysFromToday(-1);
    const venue = await createTestVenue('Cut At 2am SGT');
    await bookEvent(venue.id, { attendance: 100, date: yesterday, coordinator: coordinatorId });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`${yesterday}T18:00:00Z`)); // 02:00 on `today` in Singapore
    expect(todayInSingapore()).toBe(today);

    const saved = await updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, maxCapacity: 99 });

    expect(saved.maxCapacity).toBe(99);
    expect(await noticesFor(venue.id)).toEqual([]);
  });

  it('judges "future" inside the save against the Singapore date it is given', async () => {
    const eventDate = daysFromToday(10);
    const venue = await createTestVenue('Cut Given Today');
    await bookEvent(venue.id, { attendance: 100, date: eventDate, coordinator: coordinatorId });

    // On the event's own date it is still to come.
    const onTheDay = await saveVenueChanges(venue.id, venue.updatedAt, { maxCapacity: 99 }, { today: eventDate });
    expect(onTheDay.data).toBe('affected_bookings');

    // The day after, it has happened and no longer counts.
    const dayAfter = await saveVenueChanges(
      venue.id,
      venue.updatedAt,
      { maxCapacity: 99 },
      { today: daysFromToday(11) },
    );
    expect(dayAfter.data).toBe('updated');
    expect(await noticesFor(venue.id)).toEqual([]);
  });

  it('never asks when the maximum is raised', async () => {
    const venue = await createTestVenue('Capacity Raised');
    await bookEvent(venue.id, { attendance: 100, coordinator: coordinatorId });

    const saved = await updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, maxCapacity: 250 });

    expect(saved.maxCapacity).toBe(250);
  });
});

describe('updateVenue: SCRUM-120 AC3, a cut down to exactly the expected attendance', () => {
  it('US-11.4-TC03 SCRUM-120 AC3 applies a maximum of 100 against a booking of 100 with no warning', async () => {
    const venue = await createTestVenue('Cut To Attendance');
    await bookEvent(venue.id, { attendance: 100, coordinator: coordinatorId });

    const saved = await updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, maxCapacity: 100 });

    expect(saved.maxCapacity).toBe(100);
    expect(await noticesFor(venue.id)).toEqual([]);
  });
});

describe('updateVenue: SCRUM-120 AC4, the coordinator of each affected event is notified', () => {
  it('US-11.4-TC04 SCRUM-120 AC4 records one notice per affected event, addressed to its coordinator', async () => {
    const venue = await createTestVenue('Cut Notifies');
    const assigned = await bookEvent(venue.id, { attendance: 120, coordinator: coordinatorId });
    const unassigned = await bookEvent(venue.id, { attendance: 150 });
    await bookEvent(venue.id, { attendance: 80, coordinator: coordinatorId });

    await updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, maxCapacity: 99, confirmAffectedBookings: true });

    const notices = await noticesFor(venue.id);
    expect(notices).toHaveLength(2);
    expect(notices).toEqual(
      expect.arrayContaining([
        {
          event_request_id: assigned,
          coordinator_id: coordinatorId,
          previous_capacity: 200,
          new_capacity: 99,
          expected_attendance: 120,
        },
        // Affected all the same; there is just nobody assigned to tell yet.
        {
          event_request_id: unassigned,
          coordinator_id: null,
          previous_capacity: 200,
          new_capacity: 99,
          expected_attendance: 150,
        },
      ]),
    );
  });
});
