import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createVenue } from '@/domain/venues/service';
import {
  findUnavailablePeriods,
  listAffectedBookings,
  listUpcomingUnavailablePeriods,
  markPeriodUnavailable,
} from '@/domain/availability/service';
import { formatSingaporeDate, todayInSingapore } from '@/domain/shared/dates';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-151 Withdraw venue availability when circumstances change: AC1 to AC3,
 * in time ranges since SCRUM-239 AC6.
 *
 * SCRUM-239 AC6 (Jira, authoritative): "Given Venue Staff mark a venue
 * unavailable from 14:00 to 16:30, when they save, then only bookings
 * overlapping that period are flagged — SCRUM-151's behaviour applied to time
 * ranges."
 * SCRUM-151 AC1: "Given I select a venue, a date and the affected slots and
 * record a reason, when I save, then those slots are recorded as unavailable
 * and are no longer offered for new bookings." (slots now a period)
 * SCRUM-151 AC2: "Given an affected slot carries a confirmed booking for an
 * upcoming event, when I save the change, then the booking is flagged as
 * affected and the assigned Event Coordinator is notified with the reason."
 * SCRUM-151 AC3: "Given a coordinator has been notified of an affected
 * booking, when they open the event, then the affected booking is listed with
 * an outstanding action until they release or replace it."
 *
 * "No longer offered" is tested end to end through search (venue-search),
 * request (submit-venue-booking-request) and the calendar (venue-calendar),
 * which all read the period's times since SCRUM-239 Parts 1 to 3.
 *
 * Bookings are venue_booking rows with their own date and times, added
 * directly. Releasing one is done by removing its row here; SCRUM-231's
 * release through the app is tested in venue-booking-release.test.ts.
 *
 * Runs against the local Supabase stack: the exclusion constraint is what
 * makes an overlapping period save nothing at all, and mark_period_unavailable
 * writes the notices in the same transaction as the period.
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let locationId: string;
let venueStaffId: string;
let organiserId: string;
let coordinatorId: string;
const venueIds: string[] = [];
const requestIds: string[] = [];

/** The Singapore date `days` from today, as YYYY-MM-DD. */
function daysFromToday(days: number): string {
  const date = new Date(`${todayInSingapore()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A venue of this file's own, open 07:00-18:00, so a period in the evening can be refused. */
async function createTestVenue(label: string) {
  const venue = await createVenue({ name: `${label} ${RUN}`, locationId, maxCapacity: 100, opensAt: '07:00', closesAt: '18:00' });
  venueIds.push(venue.id);
  return venue;
}

async function rowsFor(venueId: string) {
  const { data, error } = await admin
    .from('venue_unavailable_slot')
    .select('date, start_time, end_time, reason, recorded_by')
    .eq('venue_id', venueId);
  if (error || !data) throw new Error(`could not read unavailable periods: ${error?.message}`);
  return data.map((row) => ({ ...row, start_time: row.start_time.slice(0, 5), end_time: row.end_time.slice(0, 5) }));
}

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+unavailable${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user returned'}`);
  return data.user.id;
}

type Period = { start: string; end: string };

/**
 * A confirmed booking of an event into the venue for each period on the date,
 * added directly rather than through a request. The assignment is an update
 * after the submission, because event_request_assignment_needs_submission
 * refuses a coordinator on a draft.
 */
async function bookEvent(
  venueId: string,
  { date, periods, coordinator }: { date: string; periods: Period[]; coordinator: string | null },
): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: CLIENT_ORGANISATION_ID,
      name: `Unavailable Period Event ${RUN}`,
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

  if (periods.length > 0) {
    const { error: bookError } = await admin
      .from('venue_booking')
      .insert(periods.map(({ start, end }) => ({ venue_id: venueId, event_request_id: id, date, start_time: start, end_time: end })));
    if (bookError) throw new Error(`could not book test request: ${bookError.message}`);
  }
  return id;
}

async function noticesFor(eventId: string) {
  const { data, error } = await admin
    .from('venue_unavailability_notice')
    .select('coordinator_id, slot_date, start_time, end_time, reason')
    .eq('event_request_id', eventId);
  if (error || !data) throw new Error(`could not read notices: ${error?.message}`);
  return data.map((row) => ({ ...row, start_time: row.start_time?.slice(0, 5), end_time: row.end_time?.slice(0, 5) }));
}

/** AC2's flag: the event's bookings that are affected, as their times. */
async function affectedBookingsOf(eventId: string) {
  const { data, error } = await admin.from('affected_booking_slot').select('start_time, end_time').eq('event_request_id', eventId);
  if (error || !data) throw new Error(`could not read affected bookings: ${error?.message}`);
  return data.map((row) => `${row.start_time?.slice(0, 5)}-${row.end_time?.slice(0, 5)}`).sort();
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);

  const { data: location, error } = await admin
    .from('locations')
    .insert({ name: `Unavailable Slots Location ${RUN}` })
    .select('id')
    .single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;

  venueStaffId = await createUser('venue-staff');
  organiserId = await createUser('organiser');
  coordinatorId = await createUser('coordinator');
});

afterAll(async () => {
  // Requests first: their bookings and notices go with them (cascade), and
  // venue_booking holds on to its venue (restrict). Then venues, whose
  // unavailable slots go with them. Accounts last: recorded_by and the
  // notices' coordinator_id are ON DELETE RESTRICT.
  for (const id of requestIds) {
    await admin.from('event_request').delete().eq('id', id);
  }
  for (const id of venueIds) {
    await admin.from('venues').delete().eq('id', id);
  }
  for (const id of [venueStaffId, organiserId, coordinatorId]) {
    if (id) await admin.auth.admin.deleteUser(id);
  }
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
});

describe('markPeriodUnavailable (SCRUM-239 AC6, SCRUM-151 AC1)', () => {
  it('records the period, with the reason and who recorded it', async () => {
    const venue = await createTestVenue('Hall A');
    const date = daysFromToday(5);

    const saved = await markPeriodUnavailable(
      venue.id,
      { date, start: '14:00', end: '16:30', reason: '  Ceiling repair ' },
      venueStaffId,
    );

    expect(saved.unavailablePeriods.map(({ start, end }) => `${start}-${end}`)).toEqual(['14:00-16:30']);
    expect(await rowsFor(venue.id)).toEqual([
      { date, start_time: '14:00', end_time: '16:30', reason: 'Ceiling repair', recorded_by: venueStaffId },
    ]);
  });

  it('refuses a period overlapping one already unavailable, names it, and saves nothing', async () => {
    const venue = await createTestVenue('Hall B');
    const date = daysFromToday(5);
    await markPeriodUnavailable(venue.id, { date, start: '09:00', end: '12:00', reason: 'Power outage' }, venueStaffId);

    await expect(
      markPeriodUnavailable(venue.id, { date, start: '11:00', end: '13:00', reason: 'Ceiling repair' }, venueStaffId),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: `${formatSingaporeDate(date)} 09:00–12:00 is already unavailable. Nothing was saved.`,
      details: { reason: 'already_unavailable' },
    });

    expect(await rowsFor(venue.id)).toEqual([expect.objectContaining({ start_time: '09:00', reason: 'Power outage' })]);
  });

  it('accepts a period that only touches one already unavailable (half-open)', async () => {
    const venue = await createTestVenue('Hall U');
    const date = daysFromToday(5);
    await markPeriodUnavailable(venue.id, { date, start: '14:00', end: '16:30', reason: 'Ceiling repair' }, venueStaffId);

    const saved = await markPeriodUnavailable(venue.id, { date, start: '16:30', end: '18:00', reason: 'Cleaning' }, venueStaffId);

    expect(saved.unavailablePeriods.map(({ start, end }) => `${start}-${end}`)).toEqual(['14:00-16:30', '16:30-18:00']);
  });

  it("refuses a period outside the venue's opening hours, and saves nothing", async () => {
    const venue = await createTestVenue('Hall C');

    await expect(
      markPeriodUnavailable(venue.id, { date: daysFromToday(5), start: '17:00', end: '19:00', reason: 'Flooding' }, venueStaffId),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('is open 07:00–18:00') });
    expect(await rowsFor(venue.id)).toEqual([]);
  });

  it('refuses a blank reason before writing anything', async () => {
    const venue = await createTestVenue('Hall D');

    await expect(
      markPeriodUnavailable(venue.id, { date: daysFromToday(5), start: '09:00', end: '10:00', reason: '   ' }, venueStaffId),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'A reason is required.' });
    expect(await rowsFor(venue.id)).toEqual([]);
  });

  it('reports an unknown venue as not found', async () => {
    await expect(
      markPeriodUnavailable(
        '99999999-9999-4999-8999-999999999999',
        { date: daysFromToday(5), start: '09:00', end: '10:00', reason: 'Ceiling repair' },
        venueStaffId,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('findUnavailablePeriods: which periods are withdrawn on a date', () => {
  it('answers with each period and its recorded reason, and only overlapping ones when given a range', async () => {
    const venue = await createTestVenue('Hall E');
    const date = daysFromToday(7);
    await markPeriodUnavailable(venue.id, { date, start: '09:00', end: '10:00', reason: 'Ceiling repair' }, venueStaffId);
    await markPeriodUnavailable(venue.id, { date, start: '14:00', end: '16:30', reason: 'Power outage' }, venueStaffId);

    const all = await findUnavailablePeriods(venue.id, date);
    expect(all.map(({ start, end, reason }) => `${start}-${end} ${reason}`)).toEqual([
      '09:00-10:00 Ceiling repair',
      '14:00-16:30 Power outage',
    ]);
    expect((await findUnavailablePeriods(venue.id, date, { start: '10:00', end: '14:00' })).length).toBe(0);
    expect(await findUnavailablePeriods(venue.id, daysFromToday(8))).toEqual([]);
  });
});

describe('affected bookings and their coordinators (SCRUM-239 AC6, SCRUM-151 AC2)', () => {
  it('TC-239-14: flags only the bookings overlapping 14:00-16:30', async () => {
    const venue = await createTestVenue('Hall V');
    const date = daysFromToday(10);
    const before = await bookEvent(venue.id, { date, periods: [{ start: '10:00', end: '12:00' }], coordinator: coordinatorId });
    const acrossStart = await bookEvent(venue.id, { date, periods: [{ start: '13:00', end: '14:30' }], coordinator: coordinatorId });
    const inside = await bookEvent(venue.id, { date, periods: [{ start: '15:00', end: '16:00' }], coordinator: coordinatorId });
    const touchingEnd = await bookEvent(venue.id, { date, periods: [{ start: '16:30', end: '18:00' }], coordinator: coordinatorId });

    const outcome = await markPeriodUnavailable(venue.id, { date, start: '14:00', end: '16:30', reason: 'Ceiling repair' }, venueStaffId);

    expect(outcome.notifiedBookings).toBe(2);
    expect(await affectedBookingsOf(acrossStart)).toEqual(['13:00-14:30']);
    expect(await affectedBookingsOf(inside)).toEqual(['15:00-16:00']);
    expect(await affectedBookingsOf(before)).toEqual([]);
    expect(await affectedBookingsOf(touchingEnd)).toEqual([]);
  });

  it('TC-239-19: does not flag a booking ending exactly when the period starts', async () => {
    const venue = await createTestVenue('Hall W');
    const date = daysFromToday(10);
    const eventId = await bookEvent(venue.id, { date, periods: [{ start: '12:00', end: '14:00' }], coordinator: coordinatorId });

    const outcome = await markPeriodUnavailable(venue.id, { date, start: '14:00', end: '16:30', reason: 'Ceiling repair' }, venueStaffId);

    expect(outcome.notifiedBookings).toBe(0);
    expect(await affectedBookingsOf(eventId)).toEqual([]);
    expect(await noticesFor(eventId)).toEqual([]);
  });

  it('flags an overlapping upcoming booking and notifies its coordinator with the period and reason', async () => {
    const venue = await createTestVenue('Hall H');
    const date = daysFromToday(10);
    const eventId = await bookEvent(venue.id, { date, periods: [{ start: '13:00', end: '15:00' }], coordinator: coordinatorId });

    const outcome = await markPeriodUnavailable(venue.id, { date, start: '14:00', end: '16:30', reason: 'Ceiling repair' }, venueStaffId);

    expect(outcome.notifiedBookings).toBe(1);
    expect(await affectedBookingsOf(eventId)).toEqual(['13:00-15:00']);
    expect(await noticesFor(eventId)).toEqual([
      { coordinator_id: coordinatorId, slot_date: date, start_time: '14:00', end_time: '16:30', reason: 'Ceiling repair' },
    ]);
    const { data: sent } = await admin.from('notifications').select('recipient_id, type, message').eq('event_request_id', eventId);
    expect(sent).toEqual([
      {
        recipient_id: coordinatorId,
        type: 'venue_booking_update',
        message: `Your booking at ${venue.name} is affected: ${formatSingaporeDate(date)} 14:00–16:30 is no longer available (Ceiling repair).`,
      },
    ]);
  });

  it('leaves the event not cancelled, with its status unchanged (SCRUM-151 AC2, Week 7 change #2)', async () => {
    const venue = await createTestVenue('Hall T');
    const date = daysFromToday(10);
    const eventId = await bookEvent(venue.id, { date, periods: [{ start: '09:00', end: '11:00' }], coordinator: coordinatorId });
    const statusOf = async () => (await admin.from('event_request').select('status').eq('id', eventId).single()).data?.status;
    const before = await statusOf();

    await markPeriodUnavailable(venue.id, { date, start: '10:00', end: '12:00', reason: 'Ceiling repair' }, venueStaffId);

    expect(await affectedBookingsOf(eventId)).toEqual(['09:00-11:00']);
    expect(await statusOf()).toBe(before);
    expect(await statusOf()).not.toBe('cancelled');
  });

  it('sends one notice per event, even when two of its bookings overlap the period', async () => {
    const venue = await createTestVenue('Hall I');
    const date = daysFromToday(10);
    const eventId = await bookEvent(venue.id, {
      date,
      periods: [
        { start: '09:00', end: '10:00' },
        { start: '10:30', end: '11:30' },
      ],
      coordinator: coordinatorId,
    });

    await markPeriodUnavailable(venue.id, { date, start: '09:30', end: '11:00', reason: 'Flooding' }, venueStaffId);

    expect(await affectedBookingsOf(eventId)).toEqual(['09:00-10:00', '10:30-11:30']);
    expect(await noticesFor(eventId)).toEqual([expect.objectContaining({ start_time: '09:30', end_time: '11:00', reason: 'Flooding' })]);
  });

  it('leaves bookings at another time or on another date alone', async () => {
    const venue = await createTestVenue('Hall J');
    const date = daysFromToday(10);
    const otherTime = await bookEvent(venue.id, { date, periods: [{ start: '13:00', end: '15:00' }], coordinator: coordinatorId });
    const otherDate = await bookEvent(venue.id, { date: daysFromToday(11), periods: [{ start: '09:00', end: '11:00' }], coordinator: coordinatorId });

    const outcome = await markPeriodUnavailable(venue.id, { date, start: '09:00', end: '11:00', reason: 'Ceiling repair' }, venueStaffId);

    expect(outcome.notifiedBookings).toBe(0);
    for (const eventId of [otherTime, otherDate]) {
      expect(await affectedBookingsOf(eventId)).toEqual([]);
      expect(await noticesFor(eventId)).toEqual([]);
    }
  });

  it('does not notify anyone about an event that has already happened', async () => {
    const venue = await createTestVenue('Hall K');
    const yesterday = daysFromToday(-1);
    const eventId = await bookEvent(venue.id, { date: yesterday, periods: [{ start: '09:00', end: '11:00' }], coordinator: coordinatorId });

    const outcome = await markPeriodUnavailable(venue.id, { date: yesterday, start: '09:00', end: '11:00', reason: 'Late record' }, venueStaffId);

    expect(outcome.notifiedBookings).toBe(0);
    expect(await noticesFor(eventId)).toEqual([]);
  });

  it('still flags a booking whose event has no coordinator, with nobody to notify', async () => {
    const venue = await createTestVenue('Hall L');
    const date = daysFromToday(10);
    const eventId = await bookEvent(venue.id, { date, periods: [{ start: '09:00', end: '11:00' }], coordinator: null });

    const outcome = await markPeriodUnavailable(venue.id, { date, start: '09:00', end: '11:00', reason: 'Ceiling repair' }, venueStaffId);

    expect(outcome.notifiedBookings).toBe(0);
    expect(await affectedBookingsOf(eventId)).toEqual(['09:00-11:00']);
    expect(await noticesFor(eventId)).toEqual([]);
  });

  it('writes no notice when the save is refused for overlapping a period already unavailable', async () => {
    const venue = await createTestVenue('Hall M');
    const date = daysFromToday(10);
    const eventId = await bookEvent(venue.id, { date, periods: [{ start: '09:00', end: '15:00' }], coordinator: coordinatorId });
    await markPeriodUnavailable(venue.id, { date, start: '09:00', end: '10:00', reason: 'Power outage' }, venueStaffId);

    await expect(
      markPeriodUnavailable(venue.id, { date, start: '09:30', end: '14:00', reason: 'Ceiling repair' }, venueStaffId),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(await noticesFor(eventId)).toEqual([expect.objectContaining({ start_time: '09:00', reason: 'Power outage' })]);
  });
});

describe("the coordinator's outstanding action (SCRUM-151 AC3, in times)", () => {
  /** Removing the booking row is how these tests "release" it (see the note at the top). */
  async function releaseByHand(venueId: string, eventId: string) {
    const { error } = await admin.from('venue_booking').delete().eq('venue_id', venueId).eq('event_request_id', eventId);
    if (error) throw new Error(`could not release test booking: ${error.message}`);
  }

  it('lists an affected booking with its venue, date and times, and each overlapping period with its reason', async () => {
    const venue = await createTestVenue('Hall N');
    const date = daysFromToday(12);
    const eventId = await bookEvent(venue.id, { date, periods: [{ start: '09:00', end: '15:00' }], coordinator: coordinatorId });
    await markPeriodUnavailable(venue.id, { date, start: '13:00', end: '14:00', reason: 'Power outage' }, venueStaffId);
    await markPeriodUnavailable(venue.id, { date, start: '10:00', end: '11:00', reason: 'Ceiling repair' }, venueStaffId);

    expect(await listAffectedBookings(eventId)).toEqual([
      expect.objectContaining({
        venueId: venue.id,
        venueName: venue.name,
        date,
        start: '09:00',
        end: '15:00',
        unavailable: [
          { start: '10:00', end: '11:00', reason: 'Ceiling repair' },
          { start: '13:00', end: '14:00', reason: 'Power outage' },
        ],
      }),
    ]);
  });

  it('keeps listing it until the booking is released, then stops', async () => {
    const venue = await createTestVenue('Hall O');
    const date = daysFromToday(12);
    const eventId = await bookEvent(venue.id, { date, periods: [{ start: '09:00', end: '11:00' }], coordinator: coordinatorId });
    await markPeriodUnavailable(venue.id, { date, start: '09:00', end: '11:00', reason: 'Ceiling repair' }, venueStaffId);
    expect(await listAffectedBookings(eventId)).toHaveLength(1);

    await releaseByHand(venue.id, eventId);

    expect(await listAffectedBookings(eventId)).toEqual([]);
  });

  it('keeps listing it until the booking is replaced: a new booking elsewhere, then the old one released', async () => {
    const venue = await createTestVenue('Hall P');
    const replacement = await createTestVenue('Hall Q');
    const date = daysFromToday(12);
    const eventId = await bookEvent(venue.id, { date, periods: [{ start: '09:00', end: '11:00' }], coordinator: coordinatorId });
    await markPeriodUnavailable(venue.id, { date, start: '09:00', end: '11:00', reason: 'Ceiling repair' }, venueStaffId);

    // The replacement alone does not clear it: the old booking is still held.
    const { error } = await admin
      .from('venue_booking')
      .insert({ venue_id: replacement.id, event_request_id: eventId, date, start_time: '09:00', end_time: '11:00' });
    if (error) throw new Error(`could not book the replacement: ${error.message}`);
    expect((await listAffectedBookings(eventId)).map((booking) => booking.venueId)).toEqual([venue.id]);

    await releaseByHand(venue.id, eventId);

    expect(await listAffectedBookings(eventId)).toEqual([]);
  });

  it('does not list a booking of an event that has already happened', async () => {
    const venue = await createTestVenue('Hall R');
    const yesterday = daysFromToday(-1);
    const eventId = await bookEvent(venue.id, { date: yesterday, periods: [{ start: '09:00', end: '11:00' }], coordinator: coordinatorId });
    await markPeriodUnavailable(venue.id, { date: yesterday, start: '09:00', end: '11:00', reason: 'Late record' }, venueStaffId);

    expect(await listAffectedBookings(eventId)).toEqual([]);
  });

  it("lists nothing when the withdrawn period does not overlap the event's booking", async () => {
    const venue = await createTestVenue('Hall S');
    const date = daysFromToday(12);
    const eventId = await bookEvent(venue.id, { date, periods: [{ start: '13:00', end: '15:00' }], coordinator: coordinatorId });
    await markPeriodUnavailable(venue.id, { date, start: '09:00', end: '13:00', reason: 'Ceiling repair' }, venueStaffId);

    expect(await listAffectedBookings(eventId)).toEqual([]);
  });

  it('still lists a booking from before the switch to times (slot only, AC7) when a period overlaps it', async () => {
    const venue = await createTestVenue('Hall X');
    const date = daysFromToday(12);
    const eventId = await bookEvent(venue.id, { date, periods: [], coordinator: coordinatorId });
    const { error } = await admin.from('venue_booking').insert({ venue_id: venue.id, event_request_id: eventId, date, slot: 'am' });
    if (error) throw new Error(`could not add the slot booking: ${error.message}`);

    await markPeriodUnavailable(venue.id, { date, start: '11:00', end: '13:00', reason: 'Ceiling repair' }, venueStaffId);

    expect(await listAffectedBookings(eventId)).toEqual([expect.objectContaining({ start: '07:00', end: '12:00' })]);
  });
});

describe('listUpcomingUnavailablePeriods: the venue page list', () => {
  it('lists today and later only, soonest first, and by start time within a day', async () => {
    const venue = await createTestVenue('Hall G');
    await markPeriodUnavailable(venue.id, { date: daysFromToday(-1), start: '09:00', end: '10:00', reason: 'Yesterday' }, venueStaffId);
    await markPeriodUnavailable(venue.id, { date: daysFromToday(3), start: '14:00', end: '16:30', reason: 'Later' }, venueStaffId);
    await markPeriodUnavailable(venue.id, { date: daysFromToday(3), start: '09:00', end: '10:00', reason: 'Later, earlier' }, venueStaffId);
    await markPeriodUnavailable(venue.id, { date: daysFromToday(1), start: '13:00', end: '14:00', reason: 'Sooner' }, venueStaffId);

    const listed = await listUpcomingUnavailablePeriods(venue.id);
    expect(listed.map(({ date, start, end }) => `${date} ${start}-${end}`)).toEqual([
      `${daysFromToday(1)} 13:00-14:00`,
      `${daysFromToday(3)} 09:00-10:00`,
      `${daysFromToday(3)} 14:00-16:30`,
    ]);
  });
});
