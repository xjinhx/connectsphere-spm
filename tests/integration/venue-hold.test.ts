import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createVenue, searchVenues } from '@/domain/venues/service';
import { getVenueCalendar } from '@/domain/venues/calendar';
import { getCommittedPeriods, getVenueCommitments } from '@/domain/availability/service';
import { createVenueHold, getVenueHold, listActiveVenueHolds } from '@/domain/venue-hold/service';
import { decideVenueBookingRequest } from '@/domain/venue-booking/service';
import { todayInSingapore } from '@/domain/shared/dates';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-227 Hold a venue until an expiry, against the local Supabase stack.
 * The rules on their own are in tests/unit/venue-hold.test.ts.
 *
 * AC text is from the Jira card (authoritative):
 *   AC1 "Given I choose an event, a venue, a date, a start and end time and an
 *        expiry date and time in the future, when I save, then the hold is
 *        recorded as active."
 *   AC2 "Given I leave the expiry empty or set it in the past, when I save,
 *        then the hold is refused and I am told a future expiry is required."
 *   AC3 "Given a start and end time has an active hold for event A, when a
 *        coordinator of event B searches for or requests that slot, then the
 *        venue is not returned and the request is refused."
 *   AC4 "... when Venue Staff try to approve event B's request for it, then
 *        approval is refused and the hold is named."
 *   AC5 "... when event A's request for that slot is approved, then a
 *        confirmed booking is created and the hold is closed."
 *   AC6 "Given a hold's expiry has passed without an approved booking, when
 *        the a start and end time is searched, requested or shown on the
 *        calendar, then it is available again and the hold is never counted
 *        as a confirmed booking."
 *   AC7 "Given a start and end time has an active hold, when it is shown on
 *        the venue calendar with held period labelled Held with its expiry
 *        time."
 *
 * AC3, AC4 and AC6 reach the user through SCRUM-239's search, request,
 * approval and calendar, which ask getVenueCommitments. Here they are tested
 * where this story changes things: an active hold is a commitment of another
 * event's (with its event and expiry, for Venue Staff; as a bare period for a
 * coordinator), and an expired one is not. Search (#97) and the calendar (#99)
 * are in time ranges on main and are tested end to end below; the request and
 * approval checks are re-run once SCRUM-239 switches those to times.
 *
 * AC5 goes through SCRUM-148's real approval: the approved line's booking
 * closes the hold, in the same transaction (close_holds_on_booking).
 *
 * Test case IDs are from Joshua's Sprint 3 sheet (TC-227-nn).
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let locationId: string;
let venueStaffId: string;
let coordinatorId: string;
let organiserId: string;
const venueIds: string[] = [];
const eventIds: string[] = [];

function daysFromToday(days: number): string {
  const date = new Date(`${todayInSingapore()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A Singapore date-time `hours` from now, as the hold form sends it (YYYY-MM-DDTHH:MM). */
function singaporeInHours(hours: number): string {
  const instant = new Date(Date.now() + hours * 3_600_000);
  const singapore = new Date(instant.getTime() + 8 * 3_600_000);
  return singapore.toISOString().slice(0, 16);
}

const DATE = daysFromToday(40);

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+hold${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  return data.user.id;
}

async function createTestVenue(label: string) {
  const venue = await createVenue({ name: `${label} ${RUN}`, locationId, maxCapacity: 200 });
  venueIds.push(venue.id);
  return venue;
}

/** An event assigned to the test coordinator, in `status` (approved unless asked). */
async function createEvent(status: 'submitted' | 'approved' = 'approved'): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({ organiser_id: organiserId, client_organisation_id: CLIENT_ORGANISATION_ID, name: `Hold Event ${RUN}` })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test event: ${error?.message}`);
  eventIds.push(data.id);
  await admin.from('event_request').update({ status: 'submitted' }).eq('id', data.id);
  await admin.from('event_request').update({ coordinator_id: coordinatorId, assigned_by: coordinatorId }).eq('id', data.id);
  if (status === 'approved') {
    const { error: approveError } = await admin
      .from('event_request')
      .update({ status: 'approved', decision: 'approved', decided_by: coordinatorId })
      .eq('id', data.id);
    if (approveError) throw new Error(`could not approve test event: ${approveError.message}`);
  }
  return data.id;
}

/** A hold saved directly, for states the service would refuse to create (already expired). */
async function insertHold(venueId: string, eventId: string, { start, end, expiresAt, createdAt }: Record<string, string>) {
  const { data, error } = await admin
    .from('venue_hold')
    .insert({
      venue_id: venueId,
      event_request_id: eventId,
      date: DATE,
      start_time: start,
      end_time: end,
      expires_at: expiresAt,
      created_at: createdAt,
      created_by: venueStaffId,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not insert test hold: ${error?.message}`);
  return data.id;
}

async function holdCount(venueId: string) {
  const { count } = await admin.from('venue_hold').select('id', { count: 'exact', head: true }).eq('venue_id', venueId);
  return count ?? 0;
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  const { data: location, error } = await admin.from('locations').insert({ name: `Hold Location ${RUN}` }).select('id').single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;
  venueStaffId = await createUser('venue-staff');
  coordinatorId = await createUser('coordinator');
  organiserId = await createUser('organiser');
});

afterAll(async () => {
  // Events first: their holds, requests and bookings go with them (cascade).
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of venueIds) await admin.from('venues').delete().eq('id', id);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
  for (const id of [venueStaffId, coordinatorId, organiserId]) if (id) await admin.auth.admin.deleteUser(id);
});

describe('createVenueHold: SCRUM-227 AC1, a hold with a future expiry is active', () => {
  it('TC-227-01 records the hold as active, with who placed it', async () => {
    const venue = await createTestVenue('Hold Saved');
    const eventA = await createEvent();
    const expiresAt = singaporeInHours(72);

    const hold = await createVenueHold(venue.id, { eventRequestId: eventA, date: DATE, start: '10:00', end: '12:00', expiresAt }, venueStaffId);

    expect(hold).toMatchObject({ venueId: venue.id, event: { id: eventA }, date: DATE, start: '10:00', end: '12:00', state: 'active' });
    expect(hold.expiresAt).toBe(new Date(`${expiresAt}:00+08:00`).toISOString());
    const { data } = await admin.from('venue_hold').select('created_by, status').eq('id', hold.id).single();
    expect(data).toEqual({ created_by: venueStaffId, status: 'active' });
    expect((await listActiveVenueHolds(venue.id)).map((h) => h.id)).toEqual([hold.id]);
  });

  it('TC-227-02 accepts an expiry only minutes away', async () => {
    const venue = await createTestVenue('Hold Minutes');
    const hold = await createVenueHold(
      venue.id,
      { eventRequestId: await createEvent(), date: DATE, start: '14:00', end: '15:00', expiresAt: singaporeInHours(0.1) },
      venueStaffId,
    );
    expect(hold.state).toBe('active');
  });

  it('refuses an event that has not been approved', async () => {
    const venue = await createTestVenue('Hold Unapproved');
    const submitted = await createEvent('submitted');

    await expect(
      createVenueHold(venue.id, { eventRequestId: submitted, date: DATE, start: '10:00', end: '12:00', expiresAt: singaporeInHours(72) }, venueStaffId),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'Only an approved event, or one in Planning, can be held.' });
    expect(await holdCount(venue.id)).toBe(0);
  });
});

describe('createVenueHold: SCRUM-227 AC2, a future expiry is required', () => {
  const refusal = { code: 'VALIDATION_ERROR', message: 'A future expiry date and time is required.' };

  it('TC-227-03 refuses an empty expiry and records nothing', async () => {
    const venue = await createTestVenue('Hold No Expiry');
    const input = { eventRequestId: await createEvent(), date: DATE, start: '10:00', end: '12:00', expiresAt: '' };

    await expect(createVenueHold(venue.id, input, venueStaffId)).rejects.toMatchObject({
      ...refusal,
      details: { fieldErrors: { expiresAt: ['A future expiry date and time is required.'] } },
    });
    expect(await holdCount(venue.id)).toBe(0);
  });

  it('TC-227-04 refuses an expiry of yesterday', async () => {
    const venue = await createTestVenue('Hold Yesterday');
    const input = { eventRequestId: await createEvent(), date: DATE, start: '10:00', end: '12:00', expiresAt: singaporeInHours(-24) };

    await expect(createVenueHold(venue.id, input, venueStaffId)).rejects.toMatchObject(refusal);
  });

  it('TC-227-05 refuses an expiry that passed a minute ago', async () => {
    const venue = await createTestVenue('Hold Minute Ago');
    const input = { eventRequestId: await createEvent(), date: DATE, start: '10:00', end: '12:00', expiresAt: singaporeInHours(-1 / 60) };

    await expect(createVenueHold(venue.id, input, venueStaffId)).rejects.toMatchObject(refusal);
  });
});

describe('createVenueHold: one active hold or booking per period (customer #41)', () => {
  it("refuses a hold over another event's active hold, naming it", async () => {
    const venue = await createTestVenue('Hold Over Hold');
    const eventA = await createEvent();
    await createVenueHold(venue.id, { eventRequestId: eventA, date: DATE, start: '10:00', end: '12:00', expiresAt: singaporeInHours(72) }, venueStaffId);

    await expect(
      createVenueHold(venue.id, { eventRequestId: await createEvent(), date: DATE, start: '11:00', end: '13:00', expiresAt: singaporeInHours(72) }, venueStaffId),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringMatching(/10:00-12:00 on .* is held for EVT-/) });
  });

  it('refuses a hold over a confirmed booking', async () => {
    const venue = await createTestVenue('Hold Over Booking');
    await admin.from('venue_booking').insert({ venue_id: venue.id, event_request_id: await createEvent(), date: DATE, slot: 'am', start_time: '10:00', end_time: '12:00' });

    await expect(
      createVenueHold(venue.id, { eventRequestId: await createEvent(), date: DATE, start: '10:00', end: '12:00', expiresAt: singaporeInHours(72) }, venueStaffId),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringMatching(/is booked for EVT-/) });
  });

  it('allows a hold that only touches another (TC-227-08: half-open periods)', async () => {
    const venue = await createTestVenue('Hold Touching');
    await createVenueHold(venue.id, { eventRequestId: await createEvent(), date: DATE, start: '10:00', end: '12:00', expiresAt: singaporeInHours(72) }, venueStaffId);

    const next = await createVenueHold(
      venue.id,
      { eventRequestId: await createEvent(), date: DATE, start: '12:00', end: '14:00', expiresAt: singaporeInHours(72) },
      venueStaffId,
    );
    expect(next.state).toBe('active');
  });
});

describe('getVenueCommitments: SCRUM-227 AC3 and AC4, an active hold commits its period', () => {
  it('TC-227-06 / TC-227-10 returns the hold, with its event and expiry, for Venue Staff to name', async () => {
    const venue = await createTestVenue('Hold Committed');
    const eventA = await createEvent();
    const hold = await createVenueHold(venue.id, { eventRequestId: eventA, date: DATE, start: '10:00', end: '12:00', expiresAt: singaporeInHours(72) }, venueStaffId);

    expect(await getVenueCommitments(venue.id, `${DATE}T10:00`, `${DATE}T12:00`)).toEqual([
      expect.objectContaining({ kind: 'hold', date: DATE, start: '10:00', end: '12:00', eventRequestId: eventA, expiresAt: hold.expiresAt }),
    ]);
  });

  it('TC-227-07 is returned for a range that only partly overlaps it', async () => {
    const venue = await createTestVenue('Hold Partial');
    await createVenueHold(venue.id, { eventRequestId: await createEvent(), date: DATE, start: '10:00', end: '12:00', expiresAt: singaporeInHours(72) }, venueStaffId);

    expect(await getVenueCommitments(venue.id, `${DATE}T11:00`, `${DATE}T13:00`)).toHaveLength(1);
  });

  it('TC-227-08 is not returned for a range starting exactly when it ends', async () => {
    const venue = await createTestVenue('Hold Ends');
    await createVenueHold(venue.id, { eventRequestId: await createEvent(), date: DATE, start: '10:00', end: '12:00', expiresAt: singaporeInHours(72) }, venueStaffId);

    expect(await getVenueCommitments(venue.id, `${DATE}T12:00`, `${DATE}T14:00`)).toEqual([]);
  });

  it("TC-227-09 shows a coordinator only the period, never the holding event's details", async () => {
    const venue = await createTestVenue('Hold Coordinator View');
    await createVenueHold(venue.id, { eventRequestId: await createEvent(), date: DATE, start: '10:00', end: '12:00', expiresAt: singaporeInHours(72) }, venueStaffId);

    expect(await getCommittedPeriods(venue.id, `${DATE}T10:00`, `${DATE}T12:00`)).toEqual([{ date: DATE, start: '10:00', end: '12:00' }]);
  });
});

describe('search and calendar: SCRUM-227 AC3, AC6 and AC7, through SCRUM-239 search (#97) and calendar (#99)', () => {
  const venueStaff = () => ({ userId: venueStaffId, roles: ['venue_staff' as const] });
  const found = async (start: string, end: string) => (await searchVenues({ date: DATE, start, end })).venues.map((v) => v.id);

  it('TC-227-06 leaves a held venue out of a search for the held period, but not the period after it', async () => {
    const venue = await createTestVenue('Hold Search');
    await createVenueHold(venue.id, { eventRequestId: await createEvent(), date: DATE, start: '10:00', end: '12:00', expiresAt: singaporeInHours(72) }, venueStaffId);

    expect(await found('10:00', '12:00')).not.toContain(venue.id);
    expect(await found('11:00', '13:00')).not.toContain(venue.id);
    expect(await found('12:00', '14:00')).toContain(venue.id);
  });

  it('TC-227-15 shows the held period on the calendar, labelled Held with its expiry', async () => {
    const venue = await createTestVenue('Hold Calendar');
    const hold = await createVenueHold(venue.id, { eventRequestId: await createEvent(), date: DATE, start: '10:00', end: '12:00', expiresAt: singaporeInHours(72) }, venueStaffId);

    const calendar = await getVenueCalendar(venue.id, { from: DATE, to: DATE }, venueStaff());

    expect(calendar.days[0]?.periods).toEqual([
      { kind: 'held', start: '10:00', end: '12:00', reason: null, event: null, expiresAt: hold.expiresAt },
    ]);
  });

  it('TC-227-12 / TC-227-14 shows an expired hold as free in search and nowhere on the calendar', async () => {
    const venue = await createTestVenue('Hold Expired Search');
    await insertHold(venue.id, await createEvent(), {
      start: '10:00',
      end: '12:00',
      expiresAt: new Date(Date.now() - 3_600_000).toISOString(),
      createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    });

    expect(await found('10:00', '12:00')).toContain(venue.id);
    expect((await getVenueCalendar(venue.id, { from: DATE, to: DATE }, venueStaff())).days[0]?.periods).toEqual([]);
  });
});

describe('approval: SCRUM-227 AC5, the holder booking its period closes the hold', () => {
  it("TC-227-11 approving event A's request books it and closes A's hold", async () => {
    const venue = await createTestVenue('Hold Closed');
    const eventA = await createEvent();
    // Slot-shaped until SCRUM-239 switches requests to times: AM is 07:00-12:00.
    const hold = await createVenueHold(venue.id, { eventRequestId: eventA, date: DATE, start: '07:00', end: '12:00', expiresAt: singaporeInHours(72) }, venueStaffId);
    const { data: requestId, error } = await admin.rpc('create_venue_booking_request', {
      p_event_request_id: eventA,
      p_venue_id: venue.id,
      p_requested_by: coordinatorId,
      p_lines: [{ date: DATE, time_slots: ['am'] }],
    });
    if (error || !requestId) throw new Error(`could not create test request: ${error?.message}`);
    const { data: line } = await admin.from('venue_booking_request_line').select('id').eq('request_id', requestId).single();

    await decideVenueBookingRequest(requestId, venueStaffId, { decisions: [{ lineId: line!.id, decision: 'approve' }] });

    const { data: bookings } = await admin.from('venue_booking').select('status, start_time, end_time').eq('event_request_id', eventA);
    expect(bookings).toEqual([{ status: 'confirmed', start_time: '07:00:00', end_time: '12:00:00' }]);
    expect((await getVenueHold(hold.id)).state).toBe('closed');
    expect(await listActiveVenueHolds(venue.id)).toEqual([]);
  });

  it("does not close event A's hold when another event is booked elsewhere at the venue", async () => {
    const venue = await createTestVenue('Hold Kept');
    const eventA = await createEvent();
    const hold = await createVenueHold(venue.id, { eventRequestId: eventA, date: DATE, start: '10:00', end: '12:00', expiresAt: singaporeInHours(72) }, venueStaffId);

    await admin.from('venue_booking').insert({ venue_id: venue.id, event_request_id: await createEvent(), date: DATE, slot: 'pm', start_time: '13:00', end_time: '15:00' });

    expect((await getVenueHold(hold.id)).state).toBe('active');
  });
});

describe('expiry: SCRUM-227 AC6, an expired hold commits nothing and is never a booking', () => {
  it('TC-227-12 / TC-227-14 commits the period until the expiry and frees it after', async () => {
    const venue = await createTestVenue('Hold Expires');
    const eventA = await createEvent();
    const hold = await createVenueHold(venue.id, { eventRequestId: eventA, date: DATE, start: '10:00', end: '12:00', expiresAt: singaporeInHours(1) }, venueStaffId);
    const afterExpiry = new Date(Date.parse(hold.expiresAt) + 60_000);

    expect(await getVenueCommitments(venue.id, `${DATE}T10:00`, `${DATE}T12:00`)).toHaveLength(1);
    expect(await getVenueCommitments(venue.id, `${DATE}T10:00`, `${DATE}T12:00`, afterExpiry)).toEqual([]);
    expect((await getVenueHold(hold.id, afterExpiry)).state).toBe('lapsed');
    expect(await listActiveVenueHolds(venue.id, afterExpiry)).toEqual([]);

    const { data: bookings } = await admin.from('venue_booking').select('id').eq('event_request_id', eventA);
    expect(bookings).toEqual([]);
  });

  it('TC-227-13 lets another event hold the period once the first hold has expired', async () => {
    const venue = await createTestVenue('Hold Expired Reused');
    const past = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const expired = new Date(Date.now() - 3_600_000).toISOString();
    await insertHold(venue.id, await createEvent(), { start: '10:00', end: '12:00', expiresAt: expired, createdAt: past });

    const next = await createVenueHold(
      venue.id,
      { eventRequestId: await createEvent(), date: DATE, start: '10:00', end: '12:00', expiresAt: singaporeInHours(72) },
      venueStaffId,
    );
    expect(next.state).toBe('active');
  });

  it('does not close a hold that had already lapsed when its event is booked', async () => {
    const venue = await createTestVenue('Hold Lapsed Then Booked');
    const eventA = await createEvent();
    const holdId = await insertHold(venue.id, eventA, {
      start: '10:00',
      end: '12:00',
      expiresAt: new Date(Date.now() - 3_600_000).toISOString(),
      createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    });

    await admin.from('venue_booking').insert({ venue_id: venue.id, event_request_id: eventA, date: DATE, slot: 'am', start_time: '10:00', end_time: '12:00' });

    expect((await getVenueHold(holdId)).state).toBe('lapsed');
  });
});
