import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { saveVenueChanges } from '@/lib/supabase/venues';
import {
  createVenue,
  getVenue,
  listSetupTurnaroundAffectedBookings,
  updateVenue,
} from '@/domain/venues/service';
import { canViewVenueCatalogue } from '@/domain/venues/policy';
import { todayInSingapore } from '@/domain/shared/dates';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-225 Record setup and turnaround time for each venue, against the
 * local Supabase stack. The rules on their own are in
 * tests/unit/venue-setup-turnaround.test.ts.
 *
 * AC text is from the Jira card (authoritative):
 *   AC1 "... when I enter a setup time and a turnaround time in whole minutes
 *        (in 15 minutes intervals) and save, then both are stored against that
 *        venue and shown to every internal user who views it."
 *   AC2 "Given I enter a negative or any value that is not a multiple of 15,
 *        when I save, then the save is refused and the field is identified."
 *   AC3 "Given a venue has no times recorded, when it is viewed, then both show
 *        as 0 minutes."
 *   AC4 "Given two confirmed bookings 10:00-12:00 and 13:00-15:00 on 10 Nov
 *        2026, when I set its turnaround to 90 minutes and save, then both
 *        bookings are listed and must be confirmed before the change is
 *        applied."
 *   AC5 "Given I confirm that change, when it is applied, then both bookings
 *        stay confirmed and are flagged as affected, and neither is removed."
 *
 * Bookings are venue_booking rows added directly, each with its own start and
 * end time. Until SCRUM-239 switches approvals to times, the app still writes
 * a slot with every booking, so each row here also names a different slot
 * (venue_booking_one_per_slot); the check reads only the times. The bookings
 * are 30 days ahead rather than on AC4's 10 Nov 2026, so the tests keep
 * passing once that date has gone by (only bookings from today on count).
 *
 * Test case IDs are from Joshua's Sprint 3 sheet (TC-225-nn).
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let locationId: string;
let organiserId: string;
const venueIds: string[] = [];
const requestIds: string[] = [];

/** The Singapore date `days` from today, as the YYYY-MM-DD the database compares. */
function daysFromToday(days: number): string {
  const date = new Date(`${todayInSingapore()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const DATE = daysFromToday(30);

async function createTestVenue(label: string) {
  const venue = await createVenue({ name: `${label} ${RUN}`, locationId, maxCapacity: 200 });
  venueIds.push(venue.id);
  return venue;
}

/** A submitted event of its own, so each booking below belongs to a different event. */
async function createEvent(): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({ organiser_id: organiserId, client_organisation_id: CLIENT_ORGANISATION_ID, name: `Setup Turnaround Event ${RUN}` })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test request: ${error?.message}`);
  requestIds.push(data.id);
  const { error: submitError } = await admin.from('event_request').update({ status: 'submitted' }).eq('id', data.id);
  if (submitError) throw new Error(`could not submit test request: ${submitError.message}`);
  return data.id;
}

/** A confirmed booking with its own times. `slot` only keeps venue_booking_one_per_slot happy. */
async function book(
  venueId: string,
  { start, end, slot, date = DATE, eventId }: { start: string; end: string; slot: string; date?: string; eventId?: string },
): Promise<string> {
  const event = eventId ?? (await createEvent());
  const { data, error } = await admin
    .from('venue_booking')
    .insert({ venue_id: venueId, event_request_id: event, date, slot, start_time: start, end_time: end })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not book test request: ${error?.message}`);
  return data.id;
}

/** AC4's two bookings: B1 10:00-12:00 and B2 13:00-15:00, two events, one date. */
async function bookB1AndB2(venueId: string) {
  const b1 = await book(venueId, { start: '10:00', end: '12:00', slot: 'am' });
  const b2 = await book(venueId, { start: '13:00', end: '15:00', slot: 'pm' });
  return { b1, b2 };
}

async function flagsFor(venueId: string) {
  const { data, error } = await admin
    .from('setup_turnaround_affected_booking')
    .select('booking_id, setup_minutes, turnaround_minutes')
    .eq('venue_id', venueId);
  if (error || !data) throw new Error(`could not read flags: ${error?.message}`);
  return data;
}

async function statusOf(bookingId: string) {
  const { data, error } = await admin.from('venue_booking').select('status').eq('id', bookingId).maybeSingle();
  if (error) throw new Error(`could not read booking: ${error.message}`);
  return data?.status ?? null;
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  const { data, error } = await admin.from('locations').insert({ name: `Setup Turnaround Location ${RUN}` }).select('id').single();
  if (error || !data) throw new Error(`could not create test location: ${error?.message}`);
  locationId = data.id;

  const { data: user, error: userError } = await admin.auth.admin.createUser({
    email: `organiser+setup${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (userError || !user.user) throw new Error(`could not create test organiser: ${userError?.message}`);
  organiserId = user.user.id;
});

afterAll(async () => {
  // Requests first: their bookings, and the flags on those, cascade with them.
  if (requestIds.length > 0) await admin.from('event_request').delete().in('id', requestIds);
  for (const id of venueIds) await admin.from('venues').delete().eq('id', id);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
  if (organiserId) await admin.auth.admin.deleteUser(organiserId);
});

describe('updateVenue: SCRUM-225 AC1, setup and turnaround are stored', () => {
  it('TC-225-01 stores a setup of 30 and a turnaround of 45 minutes', async () => {
    const venue = await createTestVenue('Setup Saved');

    const saved = await updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, setupMinutes: 30, turnaroundMinutes: 45 });

    expect(saved).toMatchObject({ setupMinutes: 30, turnaroundMinutes: 45 });
    expect(await getVenue(venue.id)).toMatchObject({ setupMinutes: 30, turnaroundMinutes: 45 });
  });

  it('TC-225-02 lets every internal role open the venue and read the saved times', async () => {
    const venue = await createTestVenue('Setup Seen');
    await updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, setupMinutes: 30, turnaroundMinutes: 45 });

    // The venue page shows its times to anyone it lets in; only the
    // affected-bookings list is kept to Venue Staff.
    for (const role of ['coordinator', 'operations_manager', 'technical_support'] as const) {
      expect(canViewVenueCatalogue([role])).toBe(true);
    }
    expect(await getVenue(venue.id)).toMatchObject({ setupMinutes: 30, turnaroundMinutes: 45 });
  });

  it('TC-225-03 stores 0 and 15', async () => {
    const venue = await createTestVenue('Setup Lowest');

    const saved = await updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, setupMinutes: 0, turnaroundMinutes: 15 });

    expect(saved).toMatchObject({ setupMinutes: 0, turnaroundMinutes: 15 });
  });

  it('leaves the other value alone when only one is sent', async () => {
    const venue = await createTestVenue('Setup One Field');
    const first = await updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, setupMinutes: 30, turnaroundMinutes: 45 });

    const saved = await updateVenue(venue.id, { expectedUpdatedAt: first.updatedAt, turnaroundMinutes: 60 });

    expect(saved).toMatchObject({ setupMinutes: 30, turnaroundMinutes: 60 });
  });
});

describe('updateVenue: SCRUM-225 AC2, a bad value is refused and named', () => {
  it('TC-225-04 refuses a negative setup, names the field, and stores nothing', async () => {
    const venue = await createTestVenue('Setup Negative');

    await expect(updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, setupMinutes: -15 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { fieldErrors: { setupMinutes: ['Setup time cannot be negative.'] } },
    });
    expect(await getVenue(venue.id)).toMatchObject({ setupMinutes: 0, turnaroundMinutes: 0 });
  });

  it('TC-225-08 names only the invalid field, and keeps the values already saved', async () => {
    const venue = await createTestVenue('Setup One Bad');
    const before = await updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, setupMinutes: 30, turnaroundMinutes: 45 });

    const refused: unknown = await updateVenue(venue.id, {
      expectedUpdatedAt: before.updatedAt,
      setupMinutes: 60,
      turnaroundMinutes: 20,
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(refused).toMatchObject({ code: 'VALIDATION_ERROR' });
    const { fieldErrors } = (refused as { details: { fieldErrors: Record<string, string[]> } }).details;
    expect(Object.keys(fieldErrors)).toEqual(['turnaroundMinutes']);
    expect(await getVenue(venue.id)).toMatchObject({ setupMinutes: 30, turnaroundMinutes: 45 });
  });

  // The column's own check (time-model migration) is the backstop if anything
  // skips the service.
  it('is refused by the database too when the service is skipped', async () => {
    const venue = await createTestVenue('Setup Backstop');

    const { error } = await saveVenueChanges(venue.id, venue.updatedAt, { turnaroundMinutes: 14 });

    expect(error?.message).toMatch(/venues_turnaround_minutes_quarter_hours/);
  });
});

describe('getVenue: SCRUM-225 AC3, no times recorded shows 0', () => {
  it('TC-225-09 / TC-225-10 shows a venue that never had times set as 0 and 0 minutes', async () => {
    const venue = await createTestVenue('Setup Never Set');

    expect(await getVenue(venue.id)).toMatchObject({ setupMinutes: 0, turnaroundMinutes: 0 });
  });
});

describe('updateVenue: SCRUM-225 AC4, a change that makes bookings clash must be confirmed', () => {
  it('TC-225-11 lists both bookings for a 90-minute turnaround and changes nothing yet', async () => {
    const venue = await createTestVenue('Clash Listed');
    const { b1, b2 } = await bookB1AndB2(venue.id);

    await expect(updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, turnaroundMinutes: 90 })).rejects.toMatchObject({
      code: 'CONFLICT',
      details: {
        reason: 'setup_turnaround_clashes',
        setupMinutes: 0,
        turnaroundMinutes: 90,
        bookings: [
          { bookingId: b1, date: DATE, start: '10:00', end: '12:00' },
          { bookingId: b2, date: DATE, start: '13:00', end: '15:00' },
        ],
      },
    });

    const after = await getVenue(venue.id);
    expect(after.turnaroundMinutes).toBe(0);
    expect(after.updatedAt).toBe(venue.updatedAt);
    expect(await flagsFor(venue.id)).toEqual([]);
  });

  it('TC-225-12 leaves both bookings confirmed and unflagged when the change is not confirmed', async () => {
    const venue = await createTestVenue('Clash Declined');
    const { b1, b2 } = await bookB1AndB2(venue.id);

    await updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, turnaroundMinutes: 90 }).catch(() => undefined);

    expect(await statusOf(b1)).toBe('confirmed');
    expect(await statusOf(b2)).toBe('confirmed');
    expect(await listSetupTurnaroundAffectedBookings(venue.id)).toEqual([]);
  });

  it('TC-225-13 saves directly when the turnaround ends exactly as the next booking starts', async () => {
    const venue = await createTestVenue('Clash Touching');
    await bookB1AndB2(venue.id);

    const saved = await updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, turnaroundMinutes: 60 });

    expect(saved.turnaroundMinutes).toBe(60);
    expect(await flagsFor(venue.id)).toEqual([]);
  });

  it('TC-225-14 lists both for a 75-minute turnaround, one step past the gap', async () => {
    const venue = await createTestVenue('Clash One Step');
    await bookB1AndB2(venue.id);

    await expect(updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, turnaroundMinutes: 75 })).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'setup_turnaround_clashes' },
    });
  });

  it('TC-225-15 counts setup as well as turnaround', async () => {
    const venue = await createTestVenue('Clash Setup');
    await bookB1AndB2(venue.id);
    const before = await updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, turnaroundMinutes: 45 });

    await expect(updateVenue(venue.id, { expectedUpdatedAt: before.updatedAt, setupMinutes: 30 })).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'setup_turnaround_clashes', setupMinutes: 30, turnaroundMinutes: 45 },
    });
  });

  it('TC-225-16 saves directly when there is no other booking to clash with', async () => {
    const venue = await createTestVenue('Clash Solo');
    await book(venue.id, { start: '10:00', end: '12:00', slot: 'am' });

    const saved = await updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, turnaroundMinutes: 90 });

    expect(saved.turnaroundMinutes).toBe(90);
  });

  it('ignores bookings on a date that has already passed', async () => {
    const venue = await createTestVenue('Clash Past');
    const yesterday = daysFromToday(-1);
    await book(venue.id, { start: '10:00', end: '12:00', slot: 'am', date: yesterday });
    await book(venue.id, { start: '13:00', end: '15:00', slot: 'pm', date: yesterday });

    const saved = await updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, turnaroundMinutes: 90 });

    expect(saved.turnaroundMinutes).toBe(90);
  });

  it("does not clash one event's own bookings", async () => {
    const venue = await createTestVenue('Clash Same Event');
    const eventId = await createEvent();
    await book(venue.id, { start: '10:00', end: '12:00', slot: 'am', eventId });
    await book(venue.id, { start: '13:00', end: '15:00', slot: 'pm', eventId });

    const saved = await updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, turnaroundMinutes: 90 });

    expect(saved.turnaroundMinutes).toBe(90);
  });

  // The service checks first to show the list, but a booking can be confirmed
  // between that check and the save. update_venue checks again under the
  // venue lock, so calling it directly with no confirmation is still refused.
  it('refuses an unconfirmed change inside the save itself, writing nothing', async () => {
    const venue = await createTestVenue('Clash In Save');
    await bookB1AndB2(venue.id);

    const { data: outcome, error } = await saveVenueChanges(venue.id, venue.updatedAt, { turnaroundMinutes: 90 });

    expect(error).toBeNull();
    expect(outcome).toBe('setup_turnaround_clashes');
    expect((await getVenue(venue.id)).updatedAt).toBe(venue.updatedAt);
    expect(await flagsFor(venue.id)).toEqual([]);
  });

  // Every check runs before anything is written: a confirmed capacity cut no
  // longer writes its notices before an unconfirmed clash is refused.
  it('writes no capacity notice when a confirmed cut comes with an unconfirmed clash', async () => {
    const venue = await createTestVenue('Clash With Cut');
    await bookB1AndB2(venue.id);

    const { data: outcome } = await saveVenueChanges(
      venue.id,
      venue.updatedAt,
      { maxCapacity: 150, turnaroundMinutes: 90 },
      { confirmAffectedBookings: true },
    );

    expect(outcome).toBe('setup_turnaround_clashes');
    const { data: notices } = await admin.from('venue_capacity_notice').select('id').eq('venue_id', venue.id);
    expect(notices).toEqual([]);
    expect((await getVenue(venue.id)).maxCapacity).toBe(200);
  });
});

describe('updateVenue: SCRUM-225 AC5, a confirmed change flags the bookings and removes nothing', () => {
  it('TC-225-17 applies the change, keeps both bookings confirmed and flags each as affected', async () => {
    const venue = await createTestVenue('Clash Confirmed');
    const { b1, b2 } = await bookB1AndB2(venue.id);

    const saved = await updateVenue(venue.id, {
      expectedUpdatedAt: venue.updatedAt,
      turnaroundMinutes: 90,
      confirmSetupTurnaroundChange: true,
    });

    expect(saved.turnaroundMinutes).toBe(90);
    expect(await statusOf(b1)).toBe('confirmed');
    expect(await statusOf(b2)).toBe('confirmed');
    expect(await listSetupTurnaroundAffectedBookings(venue.id)).toMatchObject([
      { bookingId: b1, start: '10:00', end: '12:00', setupMinutes: 0, turnaroundMinutes: 90 },
      { bookingId: b2, start: '13:00', end: '15:00', setupMinutes: 0, turnaroundMinutes: 90 },
    ]);
  });

  it('TC-225-18 does not flag a booking the change leaves clear', async () => {
    const venue = await createTestVenue('Clash B3');
    const { b1, b2 } = await bookB1AndB2(venue.id);
    const b3 = await book(venue.id, { start: '17:00', end: '19:00', slot: 'night' });

    await updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, turnaroundMinutes: 90, confirmSetupTurnaroundChange: true });

    const flagged = (await flagsFor(venue.id)).map((flag) => flag.booking_id);
    expect(flagged.sort()).toEqual([b1, b2].sort());
    expect(flagged).not.toContain(b3);
    expect(await statusOf(b3)).toBe('confirmed');
  });
});
