import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { createVenue } from '@/domain/venues/service';
import { getVenueCalendar } from '@/domain/venues/calendar';
import type { Role } from '@/domain/identity/roles';
import type { CalendarDay, OperatingSlot } from '@/domain/venues/schema';

type Period = { slot: OperatingSlot; start?: string; end?: string };
const times = ({ start, end }: Period) => (start && end ? { start_time: start, end_time: end } : {});
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-239 AC5 View a venue's calendar in exact time ranges, against Postgres.
 * Replaces SCRUM-123's per-slot calendar; its AC1, AC3, AC4, AC7 and AC8 carry
 * over in time ranges and keep their test case IDs as regression checks.
 * AC9 and AC10 are the route's permission check, covered in
 * tests/unit/venue-calendar.test.ts and by hand.
 *
 * Bookings (venue_booking), unavailable periods (venue_unavailable_slot) and
 * pending request lines (venue_booking_request_line) are written directly
 * with their times. Each row still carries the slot it falls in, because the
 * slot columns stay required until Dylan's #89 follow-up drops them; without
 * times the migration's trigger fills them from the slot (SCRUM-239 AC7).
 *
 * The calendar is read as a coordinator who isn't assigned to any of these
 * events, so a Confirmed period carries no event; the last block checks who
 * does see it (SCRUM-148 AC3/AC4).
 *
 * Every test uses a venue of its own, so other files' rows can't change it.
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let locationId: string;
let organiserId: string;
let coordinatorId: string;
const venueIds: string[] = [];
const requestIds: string[] = [];

type Viewer = { userId: string; roles: readonly Role[] };
const otherCoordinator: Viewer = { userId: randomUUID(), roles: ['coordinator'] };

async function createTestVenue(label: string, operatingSlots: OperatingSlot[] = ['am', 'pm', 'night']) {
  const venue = await createVenue({ name: `Calendar ${label} ${RUN}`, locationId, maxCapacity: 100, operatingSlots });
  venueIds.push(venue.id);
  return venue.id;
}

async function eventRequest(date: string, slots: OperatingSlot[], coordinator: string | null = null): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: CLIENT_ORGANISATION_ID,
      name: `Calendar Event ${RUN}`,
      proposed_date: date,
      time_slots: slots,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test request: ${error?.message}`);
  requestIds.push(data.id);
  const { error: submitError } = await admin.from('event_request').update({ status: 'submitted' }).eq('id', data.id);
  if (submitError) throw new Error(`could not submit test request: ${submitError.message}`);
  if (coordinator) {
    // Assigned after submission: event_request_assignment_needs_submission refuses it on a draft.
    const { error: assignError } = await admin
      .from('event_request')
      .update({ coordinator_id: coordinator, assigned_by: coordinator })
      .eq('id', data.id);
    if (assignError) throw new Error(`could not assign test request: ${assignError.message}`);
  }
  return data.id;
}

/** A confirmed booking: one venue_booking row per period. Without times, the slot's times apply. */
async function book(venueId: string, date: string, periods: Period[], coordinator: string | null = null) {
  const eventId = await eventRequest(date, periods.map((p) => p.slot), coordinator);
  const { error } = await admin
    .from('venue_booking')
    .insert(periods.map((p) => ({ venue_id: venueId, event_request_id: eventId, date, slot: p.slot, status: 'confirmed', ...times(p) })));
  if (error) throw new Error(`could not book: ${error.message}`);
  return eventId;
}

/** A pending booking request with one line. Without times, the slot's times apply. */
async function request(venueId: string, date: string, period: Period) {
  const eventId = await eventRequest(date, [period.slot]);
  const { data, error } = await admin
    .from('venue_booking_request')
    .insert({ venue_id: venueId, event_request_id: eventId, requested_by: organiserId })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create booking request: ${error?.message}`);
  const { error: lineError } = await admin
    .from('venue_booking_request_line')
    .insert({ request_id: data.id, date, time_slots: [period.slot], ...times(period) });
  if (lineError) throw new Error(`could not create request line: ${lineError.message}`);
}

/** Venue Staff have withdrawn this period, with a reason. Without times, the slot's times apply. */
async function markUnavailable(venueId: string, date: string, period: Period, reason = 'Annual maintenance') {
  const { error } = await admin
    .from('venue_unavailable_slot')
    .insert({ venue_id: venueId, date, slot: period.slot, reason, ...times(period) });
  if (error) throw new Error(`could not record unavailable period: ${error.message}`);
}

const summary = (day: CalendarDay) => day.periods.map((p) => `${p.start}-${p.end} ${p.kind}`);


async function oneDay(venueId: string, date: string, viewer: Viewer = otherCoordinator): Promise<CalendarDay> {
  const calendar = await getVenueCalendar(venueId, { from: date, to: date }, viewer);
  expect(calendar.days).toHaveLength(1);
  return calendar.days[0]!;
}

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+calendar${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message}`);
  return data.user.id;
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  const { data, error } = await admin.from('locations').insert({ name: `Calendar Location ${RUN}` }).select('id').single();
  if (error || !data) throw new Error(`could not create test location: ${error?.message}`);
  locationId = data.id;
  organiserId = await createUser('organiser');
  coordinatorId = await createUser('coordinator');
});

afterAll(async () => {
  // Requests first: bookings and booking requests cascade with them, and a
  // venue with either cannot be deleted. Unavailable slots go with the venue.
  if (requestIds.length > 0) await admin.from('event_request').delete().in('id', requestIds);
  for (const id of venueIds) await admin.from('venues').delete().eq('id', id);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
  if (coordinatorId) await admin.auth.admin.deleteUser(coordinatorId);
  if (organiserId) await admin.auth.admin.deleteUser(organiserId);
});

describe('getVenueCalendar: SCRUM-239 AC5, periods with exact times', () => {
  it('TC-239-12: shows confirmed, pending and blocked periods each with their exact times, in time order', async () => {
    const venue = await createTestVenue('Mixed day');
    const date = '2026-12-01';
    await book(venue, date, [{ slot: 'am', start: '08:00', end: '10:00' }]);
    await request(venue, date, { slot: 'am', start: '10:30', end: '11:15' });
    await markUnavailable(venue, date, { slot: 'pm', start: '15:00', end: '16:30' }, 'Ceiling repair');
    const day = await oneDay(venue, date);
    expect(summary(day)).toEqual(['08:00-10:00 confirmed', '10:30-11:15 pending', '15:00-16:30 blocked']);
    expect(day.periods[2]).toMatchObject({ reason: 'Ceiling repair' });
  });

  it('TC-239-13: draws a booking across the old lunch break as one period, with no gap', async () => {
    const venue = await createTestVenue('Across lunch');
    const date = '2026-12-02';
    await book(venue, date, [{ slot: 'am', start: '11:30', end: '13:30' }]);
    expect(summary(await oneDay(venue, date))).toEqual(['11:30-13:30 confirmed']);
  });

  it('TC-239-15: a booking made under the slot model (PM, no times written) shows as 13:00-18:00', async () => {
    const venue = await createTestVenue('Legacy PM');
    const date = '2026-12-03';
    await book(venue, date, [{ slot: 'pm' }]);
    expect(summary(await oneDay(venue, date))).toEqual(['13:00-18:00 confirmed']);
  });

  it('TC-123-05: a day with nothing recorded has no periods', async () => {
    const venue = await createTestVenue('Empty day');
    expect((await oneDay(venue, '2026-12-04')).periods).toEqual([]);
  });

  it('TC-123-01: shows every date in the range', async () => {
    const venue = await createTestVenue('Five days');
    const calendar = await getVenueCalendar(venue, { from: '2026-12-07', to: '2026-12-11' }, otherCoordinator);
    expect(calendar.days.map((d) => d.date)).toEqual(['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11']);
  });

  it('TC-123-03, 04: refuses a range ending before it starts, or longer than 31 days', async () => {
    const venue = await createTestVenue('Bad range');
    await expect(getVenueCalendar(venue, { from: '2026-12-10', to: '2026-12-09' }, otherCoordinator)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(getVenueCalendar(venue, { from: '2026-12-01', to: '2027-01-01' }, otherCoordinator)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('reports an unknown venue as not found', async () => {
    await expect(getVenueCalendar(randomUUID(), { from: '2026-12-01', to: '2026-12-01' }, otherCoordinator)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('getVenueCalendar: SCRUM-123 AC3 in time ranges, opening hours', () => {
  it('TC-123-06: shows a venue open AM and PM as open 07:00-18:00', async () => {
    const venue = await createTestVenue('Day only', ['am', 'pm']);
    const calendar = await getVenueCalendar(venue, { from: '2026-12-05', to: '2026-12-05' }, otherCoordinator);
    expect(calendar.venue).toMatchObject({ opensAt: '07:00', closesAt: '18:00' });
  });
});

describe('getVenueCalendar: SCRUM-123 AC4 in time ranges, fully committed', () => {
  it('TC-123-08: committed periods covering the whole opening hours make the day fully committed', async () => {
    const venue = await createTestVenue('Full day', ['am', 'pm']);
    const date = '2026-12-14';
    await book(venue, date, [{ slot: 'am', start: '07:00', end: '12:00' }]);
    await markUnavailable(venue, date, { slot: 'pm', start: '12:00', end: '18:00' });
    expect((await oneDay(venue, date)).fullyCommitted).toBe(true);
  });

  it('TC-123-09: AM and PM booked leaves 12:00-13:00 free, so the day is not fully committed', async () => {
    const venue = await createTestVenue('Lunch free', ['am', 'pm']);
    const date = '2026-12-15';
    await book(venue, date, [{ slot: 'am' }, { slot: 'pm' }]);
    expect((await oneDay(venue, date)).fullyCommitted).toBe(false);
  });

  it('TC-123-14: a pending request does not count towards fully committed (AC8)', async () => {
    const venue = await createTestVenue('Pending fills gap', ['am', 'pm']);
    const date = '2026-12-16';
    await book(venue, date, [{ slot: 'am', start: '07:00', end: '12:00' }]);
    await request(venue, date, { slot: 'pm', start: '12:00', end: '18:00' });
    expect((await oneDay(venue, date)).fullyCommitted).toBe(false);
  });
});

describe('getVenueCalendar: SCRUM-123 AC8, a request is not a commitment', () => {
  it('TC-123-13: a pending request on a confirmed period is shown beside it', async () => {
    const venue = await createTestVenue('Request on booking');
    const date = '2026-12-17';
    await book(venue, date, [{ slot: 'am', start: '10:00', end: '12:00' }]);
    await request(venue, date, { slot: 'am', start: '10:00', end: '12:00' });
    expect(summary(await oneDay(venue, date))).toEqual(['10:00-12:00 confirmed', '10:00-12:00 pending']);
  });
});

describe('getVenueCalendar: who sees the event on a Confirmed period (SCRUM-148 AC3/AC4)', () => {
  it('shows the event to an Event Operations Manager', async () => {
    const venue = await createTestVenue('Seen by ops');
    const eventId = await book(venue, '2026-12-21', [{ slot: 'am', start: '09:00', end: '11:00' }]);
    const [period] = (await oneDay(venue, '2026-12-21', { userId: randomUUID(), roles: ['operations_manager'] })).periods;
    expect(period).toMatchObject({ kind: 'confirmed', start: '09:00', end: '11:00' });
    expect(period?.event?.id).toBe(eventId);
    expect(period?.event?.reference).toBeTruthy();
  });

  it("shows the event to the event's assigned coordinator", async () => {
    const venue = await createTestVenue('Seen by its coordinator');
    const eventId = await book(venue, '2026-12-22', [{ slot: 'pm' }], coordinatorId);
    const [period] = (await oneDay(venue, '2026-12-22', { userId: coordinatorId, roles: ['coordinator'] })).periods;
    expect(period?.event?.id).toBe(eventId);
  });

  it('shows any other coordinator only that the period is Confirmed', async () => {
    const venue = await createTestVenue('Hidden from others');
    await book(venue, '2026-12-23', [{ slot: 'night' }], coordinatorId);
    const [period] = (await oneDay(venue, '2026-12-23', otherCoordinator)).periods;
    expect(period).toMatchObject({ kind: 'confirmed', start: '19:00', end: '24:00', event: null });
  });
});
