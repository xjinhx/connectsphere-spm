import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { assignCoordinator } from '@/domain/assignment/service';
import { listAffectedBookings, markPeriodUnavailable } from '@/domain/availability/service';
import { createEquipmentItem } from '@/domain/equipment/service';
import { addEquipmentLine } from '@/domain/equipment-request/service';
import { listEventReservations, reserveEquipment } from '@/domain/equipment-reservation/service';
import { NO_APPROVED_BOOKING, NO_EQUIPMENT_REQUESTED } from '@/domain/essential-arrangements/policy';
import { recordEssentialArrangements } from '@/domain/essential-arrangements/service';
import type { EssentialArrangementsInput } from '@/domain/essential-arrangements/schema';
import { confirmEvent, enterPlanning } from '@/domain/event-status/service';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import type { Role } from '@/domain/identity/roles';
import { approveEventRequest } from '@/domain/review/service';
import { ConflictError, ForbiddenError } from '@/domain/shared/errors';
import { decideVenueBookingRequest, releaseVenueBooking } from '@/domain/venue-booking/service';
import { createVenue } from '@/domain/venues/service';
import { ensureTestClientOrganisation, TEST_CLIENT_ORGANISATION_ID } from './fixtures/clientOrganisation';

/**
 * SCRUM-102 Block confirmation until essential arrangements are complete,
 * against the local Supabase stack (`npm run db:start`, then the migrations
 * applied).
 *
 * The check's rules on their own are in tests/unit/confirm-event.test.ts. What
 * only a real database can show is here: that the arrangements are read as the
 * app records them (bookings approved, rejected and released by Venue Staff and
 * the coordinator, a period marked unavailable, equipment reserved by Technical
 * Support), that a refusal leaves the event in Planning, and that a
 * confirmation moves it and notifies the organiser.
 *
 * AC text is from the Jira card (authoritative); see the unit test for it.
 *   AC6 "Given an event is confirmed, when the confirmation is recorded, then
 *        the Event Organiser receives a notification stating that the event is
 *        confirmed."
 *
 * Test case IDs are from the SCRUM-102 tab of Marcus's Sprint 4 test cases
 * (TC-102-nn).
 */

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

type Account = { userId: string; roles: Role[] };

const accountIds: string[] = [];
const eventIds: string[] = [];
const equipmentIds: string[] = [];
const venueIds: string[] = [];
let locationId: string;

let manager: Account;
let organiser: Account;
let coordinator: Account;
let otherCoordinator: Account;
let venueStaff: Account;
let technicalSupport: Account;

let marina: string;
let bugis: string;
let jurong: string;
let eq1: string;
let eq2: string;
const EQ1_NAME = `EQ-102-01 ${RUN}`;
const EQ2_NAME = `EQ-102-02 ${RUN}`;

// Each event has days of its own, three apart, so no two events' bookings or
// equipment windows (the day before to the last day) overlap.
let nextDay = 0;
const dayFromStart = (offset: number) => new Date(Date.UTC(2027, 3, 1 + offset)).toISOString().slice(0, 10);

function freshDay(): string {
  const day = dayFromStart(nextDay);
  nextDay += 3;
  return day;
}

function freshTwoDays(): [string, string] {
  const days: [string, string] = [dayFromStart(nextDay), dayFromStart(nextDay + 1)];
  nextDay += 4;
  return days;
}

const dmy = (date: string) => date.split('-').reverse().join('/');

async function createAccount(label: string, roles: Role[]): Promise<Account> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+confirm${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  accountIds.push(data.user.id);
  const { error: profileError } = await admin.from('profiles').update({ roles, full_name: label }).eq('id', data.user.id);
  if (profileError) throw new Error(`could not set up profile for ${label}: ${profileError.message}`);
  return { userId: data.user.id, roles };
}

/** An event submitted, assigned to `coordinator` and approved, the way the app gets it there. */
async function createApprovedEvent(): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiser.userId,
      client_organisation_id: TEST_CLIENT_ORGANISATION_ID,
      name: `Harbour Gala ${RUN}`,
      proposed_date: '2027-04-01',
      start_time: '10:00',
      end_time: '12:00',
    })
    .select('id')
    .single();
  if (error) throw new Error(`could not create test event: ${error.message}`);
  const id = data.id as string;
  eventIds.push(id);

  await admin.from('event_request').update({ status: 'submitted' }).eq('id', id);
  await assignCoordinator(id, { coordinatorId: coordinator.userId, actorId: manager.userId });
  await approveEventRequest(id, { actorId: coordinator.userId });
  return id;
}

async function markEssential(eventId: string, essential: Partial<EssentialArrangementsInput>) {
  await recordEssentialArrangements(eventId, coordinator.userId, {
    venue: 'not_required',
    equipment: 'not_required',
    technicalSupport: 'not_required',
    registration: 'not_required',
    ...essential,
  });
}

type Line = { date: string; start: string; end: string };

/** A venue booking request for one line, as the coordinator raises it (an Approved event moves to Planning). */
async function requestVenue(eventId: string, venueId: string, line: Line): Promise<{ requestId: string; lineId: string }> {
  const { data: requestId, error } = await admin.rpc('create_venue_booking_request', {
    p_event_request_id: eventId,
    p_venue_id: venueId,
    p_requested_by: coordinator.userId,
    p_lines: [line],
  });
  if (error || !requestId) throw new Error(`could not request test booking: ${error?.message}`);
  const { data: row, error: lineError } = await admin
    .from('venue_booking_request_line')
    .select('id')
    .eq('request_id', requestId)
    .single();
  if (lineError) throw new Error(`could not read test line: ${lineError.message}`);
  return { requestId: requestId as string, lineId: row.id as string };
}

/** A confirmed booking: requested, then approved by Venue Staff. Returns its id. */
async function bookVenue(eventId: string, venueId: string, line: Line): Promise<string> {
  const { requestId, lineId } = await requestVenue(eventId, venueId, line);
  await decideVenueBookingRequest(requestId, venueStaff.userId, { decisions: [{ lineId, decision: 'approve' }] });
  const { data, error } = await admin
    .from('venue_booking')
    .select('id')
    .eq('event_request_id', eventId)
    .eq('venue_id', venueId)
    .eq('date', line.date)
    .single();
  if (error) throw new Error(`could not read test booking: ${error.message}`);
  return data.id as string;
}

/** A line for `quantity` of the item, as the coordinator records it; `reserve` of it reserved by Technical Support. */
async function requestEquipment(eventId: string, equipmentId: string, quantity: number, reserve = 0): Promise<void> {
  const { line } = await addEquipmentLine(eventId, coordinator.userId, { equipmentId, quantity });
  if (reserve > 0) await reserveEquipment(eventId, line.id, technicalSupport.userId, { quantity: reserve });
}

const asCoordinator = () => ({ userId: coordinator.userId, roles: coordinator.roles });

async function storedStatus(eventId: string): Promise<EventRequestStatus> {
  const { data, error } = await admin.from('event_request').select('status').eq('id', eventId).single();
  if (error) throw new Error(`could not read test event: ${error.message}`);
  return data.status as EventRequestStatus;
}

/** The refusal's details.outstanding, failing the test if it was not a refusal. */
async function refusalOf(eventId: string): Promise<string[]> {
  const error = await confirmEvent(eventId, asCoordinator()).then(
    () => {
      throw new Error('expected the confirmation to be refused');
    },
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ConflictError);
  return ((error as ConflictError).details as { outstanding: string[] }).outstanding;
}

async function confirmedNotifications(eventId: string) {
  const { data, error } = await admin
    .from('notifications')
    .select('recipient_id, message')
    .eq('event_request_id', eventId)
    .eq('type', 'event_confirmed');
  if (error) throw new Error(`could not read test notifications: ${error.message}`);
  return data ?? [];
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  manager = await createAccount('manager', ['operations_manager']);
  organiser = await createAccount('organiser', ['event_organiser']);
  coordinator = await createAccount('coordinator', ['coordinator']);
  otherCoordinator = await createAccount('othercoordinator', ['coordinator']);
  venueStaff = await createAccount('venuestaff', ['venue_staff']);
  technicalSupport = await createAccount('techsupport', ['technical_support']);

  const { data: location, error } = await admin.from('locations').insert({ name: `Confirm Location ${RUN}` }).select('id').single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;
  for (const [name, set] of [
    ['Marina Bay Ballroom', (id: string) => (marina = id)],
    ['Bugis Seminar Room', (id: string) => (bugis = id)],
    ['Jurong East Training Room', (id: string) => (jurong = id)],
  ] as const) {
    const venue = await createVenue({ name: `${name} ${RUN}`, locationId, maxCapacity: 200, opensAt: '07:00', closesAt: '23:00' });
    venueIds.push(venue.id);
    set(venue.id);
  }

  for (const [name, quantity, set] of [
    [EQ1_NAME, 4, (id: string) => (eq1 = id)],
    [EQ2_NAME, 2, (id: string) => (eq2 = id)],
  ] as const) {
    const item = await createEquipmentItem(
      { name, category: 'av', quantity, currentLocation: 'Bugis store room' },
      technicalSupport.userId,
    );
    equipmentIds.push(item.id);
    set(item.id);
  }
});

afterAll(async () => {
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of equipmentIds) await admin.from('equipment').delete().eq('id', id);
  for (const id of venueIds) await admin.from('venues').delete().eq('id', id);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
  for (const id of accountIds) await admin.auth.admin.deleteUser(id);
});

describe('AC1 — an essential venue that is not complete', () => {
  it('TC-102-01: a Pending line refuses confirmation, naming the line; still Planning', async () => {
    const id = await createApprovedEvent();
    const day = freshDay();
    await markEssential(id, { venue: 'essential' });
    await requestVenue(id, marina, { date: day, start: '10:00', end: '12:00' });

    expect(await refusalOf(id)).toEqual([`Venue: Marina Bay Ballroom ${RUN}, ${dmy(day)}, 10:00 to 12:00 is not yet approved.`]);
    expect(await storedStatus(id)).toBe('planning');
  });

  it('TC-102-02: an approved booking does not make up for another line still Pending', async () => {
    const id = await createApprovedEvent();
    const [first, second] = freshTwoDays();
    await markEssential(id, { venue: 'essential' });
    await bookVenue(id, bugis, { date: first, start: '10:00', end: '12:00' });
    await requestVenue(id, jurong, { date: second, start: '14:00', end: '16:00' });

    expect(await refusalOf(id)).toEqual([
      `Venue: Jurong East Training Room ${RUN}, ${dmy(second)}, 14:00 to 16:00 is not yet approved.`,
    ]);
    expect(await storedStatus(id)).toBe('planning');
  });

  it('TC-102-03: with its only line rejected, the venue has no approved booking', async () => {
    const id = await createApprovedEvent();
    const day = freshDay();
    await markEssential(id, { venue: 'essential' });
    const { requestId, lineId } = await requestVenue(id, marina, { date: day, start: '10:00', end: '12:00' });
    await decideVenueBookingRequest(requestId, venueStaff.userId, {
      decisions: [{ lineId, decision: 'reject', reason: 'Ballroom closed for a private function' }],
    });

    expect(await refusalOf(id)).toEqual([NO_APPROVED_BOOKING]);
    expect(await storedStatus(id)).toBe('planning');
  });

  it('TC-102-04: a booking made affected by an unavailable period refuses confirmation, naming it', async () => {
    const id = await createApprovedEvent();
    const day = freshDay();
    await markEssential(id, { venue: 'essential' });
    await bookVenue(id, bugis, { date: day, start: '10:00', end: '12:00' });
    await markPeriodUnavailable(bugis, { date: day, start: '10:00', end: '11:00', reason: 'Ceiling repair' }, venueStaff.userId);

    expect(await refusalOf(id)).toEqual([
      `Venue: Bugis Seminar Room ${RUN}, ${dmy(day)}, 10:00 to 12:00 is affected by an unavailable period.`,
    ]);
    expect(await storedStatus(id)).toBe('planning');
  });
});

describe('AC2 — essential equipment that is not fully reserved', () => {
  it('TC-102-05: a line 2 short refuses confirmation, naming only that item', async () => {
    const id = await createApprovedEvent();
    const day = freshDay();
    await markEssential(id, { equipment: 'essential' });
    await bookVenue(id, marina, { date: day, start: '10:00', end: '12:00' });
    await requestEquipment(id, eq1, 4, 2);
    await requestEquipment(id, eq2, 2, 2);

    expect(await refusalOf(id)).toEqual([`Equipment: ${EQ1_NAME}, 2 still to reserve.`]);
    expect(await storedStatus(id)).toBe('planning');
  });

  it('TC-102-06: essential with nothing requested refuses confirmation', async () => {
    const id = await createApprovedEvent();
    const day = freshDay();
    await markEssential(id, { equipment: 'essential' });
    await bookVenue(id, marina, { date: day, start: '10:00', end: '12:00' });

    expect(await refusalOf(id)).toEqual([NO_EQUIPMENT_REQUESTED]);
    expect(await storedStatus(id)).toBe('planning');
  });

  it('TC-102-07: one refusal names the venue line and the item together', async () => {
    const id = await createApprovedEvent();
    const day = freshDay();
    await markEssential(id, { venue: 'essential', equipment: 'essential' });
    await requestVenue(id, marina, { date: day, start: '10:00', end: '12:00' });
    await requestEquipment(id, eq1, 2);

    expect(await refusalOf(id)).toEqual([
      `Venue: Marina Bay Ballroom ${RUN}, ${dmy(day)}, 10:00 to 12:00 is not yet approved.`,
      `Equipment: ${EQ1_NAME}, 2 still to reserve.`,
    ]);
    expect(await storedStatus(id)).toBe('planning');
  });

  it('TC-102-10: equipment essential and fully reserved: confirmed', async () => {
    const id = await createApprovedEvent();
    const day = freshDay();
    await markEssential(id, { equipment: 'essential' });
    await bookVenue(id, jurong, { date: day, start: '10:00', end: '12:00' });
    await requestEquipment(id, eq2, 2, 2);

    await expect(confirmEvent(id, asCoordinator())).resolves.toEqual({ id, status: 'confirmed' });
    expect(await storedStatus(id)).toBe('confirmed');
  });
});

describe('AC3 — venue essential and every booking approved', () => {
  it('TC-102-08: two approved bookings and nothing else essential: confirmed', async () => {
    const id = await createApprovedEvent();
    const [first, second] = freshTwoDays();
    await markEssential(id, { venue: 'essential' });
    await bookVenue(id, marina, { date: first, start: '10:00', end: '12:00' });
    await bookVenue(id, bugis, { date: second, start: '10:00', end: '12:00' });

    await expect(confirmEvent(id, asCoordinator())).resolves.toEqual({ id, status: 'confirmed' });
    expect(await storedStatus(id)).toBe('confirmed');
  });

  it('TC-102-09: a released booking does not count against confirmation', async () => {
    const id = await createApprovedEvent();
    const day = freshDay();
    await markEssential(id, { venue: 'essential' });
    await bookVenue(id, bugis, { date: day, start: '10:00', end: '12:00' });
    const released = await bookVenue(id, marina, { date: day, start: '10:00', end: '12:00' });
    await releaseVenueBooking(released, coordinator.userId, { reason: 'Client needs one room only' });

    await expect(confirmEvent(id, asCoordinator())).resolves.toEqual({ id, status: 'confirmed' });
    expect(await storedStatus(id)).toBe('confirmed');
  });
});

describe('AC4 — nothing marked essential', () => {
  it('TC-102-11: confirmed', async () => {
    const id = await createApprovedEvent();
    const day = freshDay();
    await markEssential(id, {});
    await bookVenue(id, marina, { date: day, start: '10:00', end: '12:00' });

    await expect(confirmEvent(id, asCoordinator())).resolves.toEqual({ id, status: 'confirmed' });
    expect(await storedStatus(id)).toBe('confirmed');
  });
});

describe('AC5 — incomplete arrangements that are not essential stay open', () => {
  it('TC-102-12: confirmed; the line is still Pending and the item still has 2 to reserve', async () => {
    const id = await createApprovedEvent();
    const day = freshDay();
    await markEssential(id, {});
    const { lineId } = await requestVenue(id, jurong, { date: day, start: '14:00', end: '16:00' });
    await requestEquipment(id, eq1, 2);

    await expect(confirmEvent(id, asCoordinator())).resolves.toEqual({ id, status: 'confirmed' });
    expect(await storedStatus(id)).toBe('confirmed');

    const { data: line } = await admin.from('venue_booking_request_line').select('status').eq('id', lineId).single();
    expect(line?.status).toBe('pending');
    const { outstanding } = await listEventReservations(id, asCoordinator());
    expect(outstanding).toMatchObject([{ equipmentName: EQ1_NAME, outstanding: 2 }]);
  });

  it('TC-102-13: confirmed with venue not essential; the booking is still affected', async () => {
    const id = await createApprovedEvent();
    const day = freshDay();
    await markEssential(id, {});
    const bookingId = await bookVenue(id, bugis, { date: day, start: '10:00', end: '12:00' });
    await markPeriodUnavailable(bugis, { date: day, start: '10:00', end: '11:00', reason: 'Ceiling repair' }, venueStaff.userId);

    await expect(confirmEvent(id, asCoordinator())).resolves.toEqual({ id, status: 'confirmed' });
    expect(await storedStatus(id)).toBe('confirmed');
    expect((await listAffectedBookings(id)).map((affected) => affected.bookingId)).toEqual([bookingId]);
  });
});

describe('AC6 — the organiser is told', () => {
  it('TC-102-14: a confirmation notifies the organiser that the event is confirmed', async () => {
    const id = await createApprovedEvent();
    const day = freshDay();
    await markEssential(id, { venue: 'essential' });
    await bookVenue(id, marina, { date: day, start: '10:00', end: '12:00' });

    await confirmEvent(id, asCoordinator());

    const { data: event } = await admin.from('event_request').select('reference, name').eq('id', id).single();
    expect(await confirmedNotifications(id)).toEqual([
      { recipient_id: organiser.userId, message: `${event?.reference} (${event?.name}) is confirmed.` },
    ]);
  });

  it('TC-102-15: a refused confirmation sends no notification', async () => {
    const id = await createApprovedEvent();
    const day = freshDay();
    await markEssential(id, { venue: 'essential' });
    await requestVenue(id, marina, { date: day, start: '10:00', end: '12:00' });

    await refusalOf(id);
    expect(await confirmedNotifications(id)).toEqual([]);
  });
});

describe('Supplementary — who may confirm, and when', () => {
  it('TC-102-16: an Approved event is refused; still Approved', async () => {
    const id = await createApprovedEvent();

    await expect(confirmEvent(id, asCoordinator())).rejects.toThrow(
      new ConflictError('Only an event in Planning can be confirmed. This event is Approved.'),
    );
    expect(await storedStatus(id)).toBe('approved');
  });

  it('TC-102-17: another coordinator and the Event Coordinator Lead are refused; still Planning', async () => {
    const id = await createApprovedEvent();
    await enterPlanning(id);

    for (const account of [otherCoordinator, manager]) {
      await expect(confirmEvent(id, { userId: account.userId, roles: account.roles })).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(await storedStatus(id)).toBe('planning');
  });
});
