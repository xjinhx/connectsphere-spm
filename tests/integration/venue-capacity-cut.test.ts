import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { saveVenueChanges } from '@/lib/supabase/venues';
import { createVenue, getVenue, updateVenue } from '@/domain/venues/service';
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
 * Bookings are stand-in D-04 (venue_booking, added by hand here as a tester
 * would) and the notification is stand-in D-05 (a venue_capacity_notice row).
 * See docs/dummies.md.
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

/** A date `days` from today, as the YYYY-MM-DD the database compares. */
function daysFromToday(days: number): string {
  const date = new Date();
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

  const { error: bookError } = await admin.from('venue_booking').insert({ venue_id: venueId, event_request_id: id });
  if (bookError) throw new Error(`could not book test request: ${bookError.message}`);
  return id;
}

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
  it('SCRUM-120 AC2 shows the affected booking and saves nothing until confirmed', async () => {
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

  it('SCRUM-120 AC2 applies the cut once the editor confirms it', async () => {
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

  it('never asks when the maximum is raised', async () => {
    const venue = await createTestVenue('Capacity Raised');
    await bookEvent(venue.id, { attendance: 100, coordinator: coordinatorId });

    const saved = await updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, maxCapacity: 250 });

    expect(saved.maxCapacity).toBe(250);
  });
});

describe('updateVenue: SCRUM-120 AC3, a cut down to exactly the expected attendance', () => {
  it('SCRUM-120 AC3 applies a maximum of 100 against a booking of 100 with no warning', async () => {
    const venue = await createTestVenue('Cut To Attendance');
    await bookEvent(venue.id, { attendance: 100, coordinator: coordinatorId });

    const saved = await updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, maxCapacity: 100 });

    expect(saved.maxCapacity).toBe(100);
    expect(await noticesFor(venue.id)).toEqual([]);
  });
});

describe('updateVenue: SCRUM-120 AC4, the coordinator of each affected event is notified', () => {
  it('SCRUM-120 AC4 records one notice per affected event, addressed to its coordinator', async () => {
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
