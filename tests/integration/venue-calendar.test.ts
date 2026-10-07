import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { createVenue } from '@/domain/venues/service';
import { getVenueCalendar } from '@/domain/venues/calendar';
import type { Role } from '@/domain/identity/roles';
import type { CalendarDay, OperatingSlot } from '@/domain/venues/schema';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-123 View a venue's calendar with the state of each slot: AC1 to AC8,
 * against Postgres. AC9 and AC10 are the route's permission check, covered in
 * tests/unit/venue-calendar.test.ts and by hand.
 *
 * Confirmed bookings are SCRUM-148's venue_booking rows, one per venue, date
 * and slot, read through its listVenueBookings(); they are inserted directly
 * here as an approval would write them. Unavailable slots are SCRUM-151's
 * venue_unavailable_slot rows and pending requests SCRUM-142's request lines.
 *
 * The calendar is read as a coordinator who isn't assigned to any of these
 * events, so a Confirmed slot carries no event; the last block checks who does
 * see it (SCRUM-148 AC3/AC4).
 *
 * Every test uses a venue of its own, so other files' rows can't change it.
 * Test case IDs are from Self_Owned_ScrumsTest.xlsx, sheet SCRUM-123.
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

/** SCRUM-148: a confirmed booking is one venue_booking row per slot, with its own date and slot. */
async function book(venueId: string, date: string, slots: OperatingSlot[], coordinator: string | null = null) {
  const eventId = await eventRequest(date, slots, coordinator);
  const { error } = await admin
    .from('venue_booking')
    .insert(slots.map((slot) => ({ venue_id: venueId, event_request_id: eventId, date, slot, status: 'confirmed' })));
  if (error) throw new Error(`could not book: ${error.message}`);
  return eventId;
}

/** SCRUM-142: a pending booking request with one date-and-slot line. */
async function requestSlots(venueId: string, date: string, slots: OperatingSlot[]) {
  const eventId = await eventRequest(date, slots);
  const { data, error } = await admin
    .from('venue_booking_request')
    .insert({ venue_id: venueId, event_request_id: eventId, requested_by: organiserId })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create booking request: ${error?.message}`);
  const { error: lineError } = await admin
    .from('venue_booking_request_line')
    .insert({ request_id: data.id, date, time_slots: slots });
  if (lineError) throw new Error(`could not create request line: ${lineError.message}`);
}

/** SCRUM-151: Venue Staff have withdrawn this slot, with a reason. */
async function markUnavailable(venueId: string, date: string, slot: OperatingSlot, reason = 'Annual maintenance') {
  const { error } = await admin.from('venue_unavailable_slot').insert({ venue_id: venueId, date, slot, reason });
  if (error) throw new Error(`could not record unavailable slot: ${error.message}`);
}

const slotOf = (day: CalendarDay, slot: OperatingSlot) => day.slots.find((s) => s.slot === slot)!;

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

describe('getVenueCalendar: SCRUM-123 AC1, a date range', () => {
  it('TC-123-01 shows every date in the range with its AM, PM and Night slot and a state', async () => {
    const venue = await createTestVenue('Five days');
    const calendar = await getVenueCalendar(venue, { from: '2026-12-01', to: '2026-12-05' }, otherCoordinator);
    expect(calendar.days.map((d) => d.date)).toEqual(['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05']);
    for (const day of calendar.days) {
      expect(day.slots.map((s) => s.slot)).toEqual(['am', 'pm', 'night']);
      expect(day.slots.every((s) => s.state === 'available')).toBe(true);
    }
  });

  it('TC-123-02 shows one date for a single-day range', async () => {
    const venue = await createTestVenue('One day');
    const calendar = await getVenueCalendar(venue, { from: '2026-12-02', to: '2026-12-02' }, otherCoordinator);
    expect(calendar.days).toHaveLength(1);
    expect(calendar.days[0]!.slots).toHaveLength(3);
  });

  it('TC-123-03 refuses a range that ends before it starts', async () => {
    const venue = await createTestVenue('Backwards');
    await expect(getVenueCalendar(venue, { from: '2026-12-03', to: '2026-12-01' }, otherCoordinator)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { fieldErrors: { to: ['The end date cannot be before the start date.'] } },
    });
  });

  it('TC-123-04 refuses a range longer than 31 days', async () => {
    const venue = await createTestVenue('Too long');
    await expect(getVenueCalendar(venue, { from: '2026-12-04', to: '2027-01-04' }, otherCoordinator)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { fieldErrors: { to: ['A calendar can show at most 31 days.'] } },
    });
  });

  it('reports an unknown venue as not found', async () => {
    await expect(
      getVenueCalendar('00000000-0000-4000-8000-000000000000', { from: '2026-12-01', to: '2026-12-01' }, otherCoordinator),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('getVenueCalendar: SCRUM-123 AC2 and AC3, open and closed slots', () => {
  it('TC-123-05 shows an open slot with nothing recorded as available (AC2)', async () => {
    const venue = await createTestVenue('Available');
    expect(slotOf(await oneDay(venue, '2026-12-05'), 'am').state).toBe('available');
  });

  it('TC-123-06 shows every Night slot as outside operating hours (AC3)', async () => {
    const venue = await createTestVenue('Day only', ['am', 'pm']);
    const calendar = await getVenueCalendar(venue, { from: '2026-12-06', to: '2026-12-10' }, otherCoordinator);
    expect(calendar.days).toHaveLength(5);
    expect(calendar.days.every((day) => slotOf(day, 'night').state === 'outside_operating_hours')).toBe(true);
    expect(calendar.days.every((day) => slotOf(day, 'am').state === 'available')).toBe(true);
  });

  it('TC-123-07 keeps a closed slot outside operating hours even with a request on it (AC3)', async () => {
    const venue = await createTestVenue('Day only, requested', ['am', 'pm']);
    await requestSlots(venue, '2026-12-07', ['night']);
    expect(slotOf(await oneDay(venue, '2026-12-07'), 'night').state).toBe('outside_operating_hours');
  });
});

describe('getVenueCalendar: SCRUM-123 AC4, fully committed', () => {
  it('TC-123-08 shows a date committed in all three slots as fully committed', async () => {
    const venue = await createTestVenue('All booked');
    await book(venue, '2026-12-08', ['am', 'pm', 'night']);
    const day = await oneDay(venue, '2026-12-08');
    expect(day.fullyCommitted).toBe(true);
    expect(day.slots.every((s) => s.state === 'confirmed')).toBe(true);
  });

  it('TC-123-09 does not show two of three committed as fully committed', async () => {
    const venue = await createTestVenue('Two booked');
    await book(venue, '2026-12-09', ['am', 'pm']);
    const day = await oneDay(venue, '2026-12-09');
    expect(day.fullyCommitted).toBe(false);
    expect(slotOf(day, 'night').state).toBe('available');
  });
});

describe('getVenueCalendar: SCRUM-123 AC5 to AC7, the state of a slot', () => {
  it('TC-123-10 shows a confirmed booking as Confirmed (AC5)', async () => {
    const venue = await createTestVenue('Confirmed AM');
    await book(venue, '2026-12-10', ['am']);
    const day = await oneDay(venue, '2026-12-10');
    expect(slotOf(day, 'am').state).toBe('confirmed');
    expect(slotOf(day, 'pm').state).toBe('available');
  });

  it('TC-123-11 shows a pending booking request as Pending request (AC6)', async () => {
    const venue = await createTestVenue('Requested PM');
    await requestSlots(venue, '2026-12-11', ['pm']);
    const pm = slotOf(await oneDay(venue, '2026-12-11'), 'pm');
    expect(pm.state).toBe('pending_request');
    expect(pm.pendingRequests).toBe(1);
  });

  it('TC-123-12 shows a slot recorded as unavailable as Blocked, with its reason (AC7)', async () => {
    const venue = await createTestVenue('Night blocked');
    await markUnavailable(venue, '2026-12-12', 'night');
    const day = await oneDay(venue, '2026-12-12');
    expect(slotOf(day, 'night')).toMatchObject({ state: 'blocked', reason: 'Annual maintenance' });
    expect(slotOf(day, 'am').reason).toBeNull();
  });
});

describe('getVenueCalendar: SCRUM-123 AC8, a second request is not a commitment', () => {
  it('TC-123-13 leaves one confirmed commitment and shows the second request as pending', async () => {
    const venue = await createTestVenue('Confirmed then requested');
    await book(venue, '2026-12-13', ['am']);
    await requestSlots(venue, '2026-12-13', ['am']);
    const am = slotOf(await oneDay(venue, '2026-12-13'), 'am');
    expect(am).toMatchObject({ state: 'confirmed', pendingRequests: 1 });
  });

  it('TC-123-14 does not count a pending request towards a fully committed date', async () => {
    const venue = await createTestVenue('Two booked, one requested');
    await book(venue, '2026-12-14', ['am', 'pm']);
    await requestSlots(venue, '2026-12-14', ['night']);
    const day = await oneDay(venue, '2026-12-14');
    expect(day.fullyCommitted).toBe(false);
    expect(slotOf(day, 'night').state).toBe('pending_request');
  });
});

describe('getVenueCalendar: who sees the event on a Confirmed slot (SCRUM-148 AC3/AC4)', () => {
  it('shows the event to an Event Operations Manager', async () => {
    const venue = await createTestVenue('Seen by ops');
    const eventId = await book(venue, '2026-12-21', ['am']);
    const am = slotOf(await oneDay(venue, '2026-12-21', { userId: randomUUID(), roles: ['operations_manager'] }), 'am');
    expect(am.state).toBe('confirmed');
    expect(am.event?.id).toBe(eventId);
    expect(am.event?.reference).toBeTruthy();
  });

  it("shows the event to the event's assigned coordinator", async () => {
    const venue = await createTestVenue('Seen by its coordinator');
    const eventId = await book(venue, '2026-12-22', ['pm'], coordinatorId);
    const pm = slotOf(await oneDay(venue, '2026-12-22', { userId: coordinatorId, roles: ['coordinator'] }), 'pm');
    expect(pm.event?.id).toBe(eventId);
  });

  it('shows any other coordinator only that the slot is Confirmed', async () => {
    const venue = await createTestVenue('Hidden from others');
    await book(venue, '2026-12-23', ['night'], coordinatorId);
    const night = slotOf(await oneDay(venue, '2026-12-23', otherCoordinator), 'night');
    expect(night).toMatchObject({ state: 'confirmed', event: null });
  });
});
