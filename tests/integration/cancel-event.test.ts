import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { getVenueCommitments } from '@/domain/availability/service';
import { createEquipmentItem } from '@/domain/equipment/service';
import { addDays } from '@/domain/equipment-reservation/policy';
import { checkEquipmentAvailability } from '@/domain/equipment-reservation/service';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import { CANCELLATION_REASON_REQUIRED } from '@/domain/event-status/schema';
import { cancelEvent, getEventCancellation } from '@/domain/event-status/service';
import type { Role } from '@/domain/identity/roles';
import { todayInSingapore } from '@/domain/shared/dates';
import { ConflictError, ForbiddenError, ValidationError } from '@/domain/shared/errors';
import { decideVenueBookingRequest, listEventVenueBookings } from '@/domain/venue-booking/service';
import { createVenue, searchVenues } from '@/domain/venues/service';
import { ensureTestClientOrganisation, TEST_CLIENT_ORGANISATION_ID } from './fixtures/clientOrganisation';

/**
 * SCRUM-105 Cancel an event at any stage, against the local Supabase stack
 * (`npm run db:start`, then the migrations applied).
 *
 * The rules on their own (which statuses, the reason, who is told what) are in
 * tests/unit/cancel-event.test.ts. What only a real database can show is here:
 * that cancel_event records the reason, who and when; releases every booking
 * and reservation in the same transaction, so search, the calendar and the
 * equipment check see them free again; rejects a line still Pending; leaves
 * everything unchanged when it refuses; and that each person in AC4 and AC6
 * gets one notification.
 *
 * Bookings are made the app's way: a request raised (create_venue_booking_request)
 * and approved by Venue Staff (decideVenueBookingRequest), so each booking
 * knows who approved it. Reservations are inserted directly, naming who
 * reserved them, as tests/integration/equipment-availability.test.ts does.
 *
 * AC text is from the Jira card. Test case IDs are from the SCRUM-105 tab of
 * Marcus's Sprint 4 test cases (TC-105-nn).
 */

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const day = (offset: number) => addDays(todayInSingapore(), offset);
const REASON = 'Client called off the event';

type Account = { userId: string; roles: Role[] };

const accountIds: string[] = [];
const eventIds: string[] = [];
const venueIds: string[] = [];
const equipmentIds: string[] = [];
let locationId: string;

let manager: Account;
let organiser: Account;
let coordinator: Account;
let coordinator2: Account;
let lead: Account;
let venueStaff: Account;
let techSupport: Account;
let attendee: Account;

async function createAccount(label: string, roles: Role[]): Promise<Account> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+cancel${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  accountIds.push(data.user.id);
  const { error: profileError } = await admin.from('profiles').update({ roles, full_name: label }).eq('id', data.user.id);
  if (profileError) throw new Error(`could not set up profile for ${label}: ${profileError.message}`);
  return { userId: data.user.id, roles };
}

/**
 * An event in `status`, assigned to `assignedTo`. A Submitted one is not
 * decided yet; a Rejected one carries its reason, as the event_request
 * constraints require.
 */
async function createEvent(status: EventRequestStatus, assignedTo: Account = coordinator): Promise<string> {
  const now = new Date().toISOString();
  const decided = status !== 'submitted';
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiser.userId,
      client_organisation_id: TEST_CLIENT_ORGANISATION_ID,
      name: `E105 ${status} ${RUN}`,
      proposed_date: day(20),
      start_time: '10:00',
      end_time: '12:00',
      status,
      submitted_at: now,
      decision: decided ? (status === 'rejected' ? 'rejected' : 'approved') : null,
      rejection_reason: status === 'rejected' ? 'Date clashes with a client blackout' : null,
      decided_by: decided ? assignedTo.userId : null,
      decided_at: decided ? now : null,
      coordinator_id: assignedTo.userId,
      assigned_by: manager.userId,
      assigned_at: now,
    })
    .select('id')
    .single();
  if (error) throw new Error(`could not create test event: ${error.message}`);
  eventIds.push(data.id);
  return data.id;
}

async function createTestVenue(label: string): Promise<string> {
  const venue = await createVenue({ name: `${label} ${RUN}`, locationId, maxCapacity: 200, opensAt: '07:00', closesAt: '23:00' });
  venueIds.push(venue.id);
  return venue.id;
}

/** A Pending line for `date` 10:00 to 12:00 at the venue, raised by the event's coordinator. */
async function requestLine(eventId: string, venueId: string, date: string, by: Account = coordinator) {
  const { data: requestId, error } = await admin.rpc('create_venue_booking_request', {
    p_event_request_id: eventId,
    p_venue_id: venueId,
    p_requested_by: by.userId,
    p_lines: [{ date, start: '10:00', end: '12:00' }],
  });
  if (error || !requestId) throw new Error(`could not create test request: ${error?.message}`);
  const { data: line } = await admin.from('venue_booking_request_line').select('id').eq('request_id', requestId).single();
  if (!line) throw new Error('could not find test request line');
  return { requestId: requestId as string, lineId: line.id };
}

/** A confirmed booking for `date` 10:00 to 12:00, requested and approved by Venue Staff. */
async function bookApproved(eventId: string, venueId: string, date: string) {
  const { requestId, lineId } = await requestLine(eventId, venueId, date);
  await decideVenueBookingRequest(requestId, venueStaff.userId, { decisions: [{ lineId, decision: 'approve' }] });
}

/** `quantity` of the item requested by the event and reserved by Technical Support. */
async function reserve(eventId: string, equipmentId: string, quantity: number, reservedBy: Account | null = techSupport) {
  await admin.from('equipment_request').upsert({ event_request_id: eventId }, { onConflict: 'event_request_id' });
  const { data: line, error } = await admin
    .from('equipment_request_line')
    .insert({ event_request_id: eventId, equipment_id: equipmentId, quantity, created_by: coordinator.userId })
    .select('id')
    .single();
  if (error || !line) throw new Error(`could not add test line: ${error?.message}`);
  if (reservedBy === null) return line.id;
  const { error: reserveError } = await admin
    .from('equipment_reservation')
    .insert({ line_id: line.id, quantity, reserved_by: reservedBy.userId } as never);
  if (reserveError) throw new Error(`could not reserve test line: ${reserveError.message}`);
  return line.id;
}

async function addItem(label: string, quantity: number): Promise<string> {
  const item = await createEquipmentItem(
    { name: `${label} ${RUN}`, category: 'av', quantity, currentLocation: 'Bugis store room' },
    techSupport.userId,
  );
  equipmentIds.push(item.id);
  return item.id;
}

async function register(eventId: string, account: Account) {
  const { error } = await admin.from('event_registration').insert({
    event_request_id: eventId,
    attendee_id: account.userId,
    full_name: 'Test Attendee',
    email: `attendee+${RUN}@connectsphere.example.com`,
    contact_number: '91234567',
  });
  if (error) throw new Error(`could not register test attendee: ${error.message}`);
}

const as = (account: Account) => ({ userId: account.userId, roles: account.roles });

async function stored(eventId: string) {
  const { data, error } = await admin
    .from('event_request')
    .select('status, cancellation_reason, cancelled_by, cancelled_at')
    .eq('id', eventId)
    .single();
  if (error) throw new Error(`could not read test event: ${error.message}`);
  return data;
}

async function notificationsFor(eventId: string) {
  const { data, error } = await admin
    .from('notifications')
    .select('recipient_id, type, message')
    .eq('event_request_id', eventId)
    .eq('type', 'event_cancelled');
  if (error) throw new Error(`could not read notifications: ${error.message}`);
  return data;
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  manager = await createAccount('manager', ['operations_manager']);
  organiser = await createAccount('organiser', ['event_organiser']);
  coordinator = await createAccount('coordinator', ['coordinator']);
  coordinator2 = await createAccount('coordinator2', ['coordinator']);
  lead = await createAccount('lead', ['operations_manager']);
  venueStaff = await createAccount('venuestaff', ['venue_staff']);
  techSupport = await createAccount('techsupport', ['technical_support']);
  attendee = await createAccount('attendee', ['attendee']);

  const { data: location, error } = await admin.from('locations').insert({ name: `Cancel Location ${RUN}` }).select('id').single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;
});

afterAll(async () => {
  await admin.from('notifications').delete().in('event_request_id', eventIds);
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of equipmentIds) await admin.from('equipment').delete().eq('id', id);
  for (const id of venueIds) await admin.from('venues').delete().eq('id', id);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
  for (const id of accountIds) await admin.auth.admin.deleteUser(id);
});

describe('AC1 — the assigned coordinator cancels an event in any status, with a reason', () => {
  it('TC-105-01: a Planning event becomes Cancelled, with the reason, the coordinator and the time', async () => {
    const id = await createEvent('planning');

    expect(await cancelEvent(id, as(coordinator), { reason: REASON })).toEqual({ id, status: 'cancelled' });

    const row = await stored(id);
    expect(row.status).toBe('cancelled');
    expect(row.cancellation_reason).toBe(REASON);
    expect(row.cancelled_by).toBe(coordinator.userId);
    expect(row.cancelled_at).not.toBeNull();
    expect(await getEventCancellation(id)).toMatchObject({ reason: REASON, byName: 'coordinator' });
  });

  it('TC-105-02: a Submitted event (the earliest stage) can be cancelled', async () => {
    const id = await createEvent('submitted');
    await cancelEvent(id, as(coordinator), { reason: 'Duplicate request' });
    expect(await stored(id)).toMatchObject({ status: 'cancelled', cancellation_reason: 'Duplicate request' });
  });

  it('TC-105-03: a Preparation event (the latest stage) can be cancelled', async () => {
    const id = await createEvent('preparation');
    await cancelEvent(id, as(coordinator), { reason: 'Venue flooded' });
    expect(await stored(id)).toMatchObject({ status: 'cancelled', cancellation_reason: 'Venue flooded' });
  });

  it('TC-105-04: no reason, or one of only spaces, is refused and the event stays Planning', async () => {
    const id = await createEvent('planning');
    for (const reason of ['', '   ']) {
      const error = await cancelEvent(id, as(coordinator), { reason }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toBe(CANCELLATION_REASON_REQUIRED);
    }
    expect(await stored(id)).toMatchObject({ status: 'planning', cancellation_reason: null });
  });

  it('TC-105-05: a Completed, Rejected or Cancelled event is refused and keeps its status', async () => {
    for (const status of ['completed', 'rejected', 'cancelled'] as const) {
      const id = await createEvent(status);
      await expect(cancelEvent(id, as(coordinator), { reason: REASON })).rejects.toBeInstanceOf(ConflictError);
      expect((await stored(id)).status).toBe(status);
    }
  });
});

describe('AC2 — anyone but the assigned coordinator is refused', () => {
  it('TC-105-06: a coordinator who is not assigned is refused; the event stays Planning', async () => {
    const id = await createEvent('planning');
    await expect(cancelEvent(id, as(coordinator2), { reason: REASON })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await stored(id)).status).toBe('planning');
  });

  it('TC-105-07: the Event Coordinator Lead is refused; the event stays Planning', async () => {
    const id = await createEvent('planning');
    await expect(cancelEvent(id, as(lead), { reason: REASON })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await stored(id)).status).toBe('planning');
  });
});

describe('AC3, AC4, AC5, AC6 — an event with bookings, a reservation and an attendee', () => {
  // E105-A: two confirmed bookings, 3 of an item of 5 reserved, one attendee.
  let eventA: string;
  let eventX: string;
  let ballroom: string;
  let seminarRoom: string;
  let item: string;
  let otherRequest: { requestId: string; lineId: string };
  const D = day(30);

  beforeAll(async () => {
    ballroom = await createTestVenue('Marina Bay Ballroom');
    seminarRoom = await createTestVenue('Bugis Seminar Room');
    item = await addItem('EQ-105-01', 5);

    eventA = await createEvent('planning');
    await bookApproved(eventA, ballroom, D);
    await bookApproved(eventA, seminarRoom, addDays(D, 1));
    await reserve(eventA, item, 3);
    await register(eventA, attendee);

    // E105-X: another event in the same window asking for 4 of the item.
    eventX = await createEvent('planning', coordinator2);
    const otherVenue = await createTestVenue('Jurong East Training Room');
    const { requestId, lineId } = await requestLine(eventX, otherVenue, D, coordinator2);
    await decideVenueBookingRequest(requestId, venueStaff.userId, { decisions: [{ lineId, decision: 'approve' }] });
    await reserve(eventX, item, 4, null);

    // E105-Y: a Pending line on the ballroom at the same time as E105-A's booking.
    const eventY = await createEvent('planning', coordinator2);
    otherRequest = await requestLine(eventY, ballroom, D, coordinator2);
  });

  it('before: the ballroom is committed, missing from search, and the item has 2 left for E105-X', async () => {
    expect(await getVenueCommitments(ballroom, `${D}T10:00`, `${D}T12:00`)).toHaveLength(1);
    const found = await searchVenues({ date: D, start: '10:00', end: '12:00' });
    expect(found.venues.map((v) => v.id)).not.toContain(ballroom);
    const line = (await checkEquipmentAvailability(eventX, as(techSupport))).lines.find((l) => l.equipmentId === item);
    expect(line?.available).toBe(2);
    await expect(
      decideVenueBookingRequest(otherRequest.requestId, venueStaff.userId, {
        decisions: [{ lineId: otherRequest.lineId, decision: 'approve' }],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    await cancelEvent(eventA, as(coordinator), { reason: REASON });
  });

  it('TC-105-08: both bookings and the reservation are Released', async () => {
    const { data: bookings } = await admin.from('venue_booking').select('status').eq('event_request_id', eventA);
    expect(bookings?.map((b) => b.status)).toEqual(['released', 'released']);
    const { data: reservations } = await admin.from('equipment_reservation').select('status').eq('event_request_id', eventA);
    expect(reservations?.map((r) => r.status)).toEqual(['released']);
  });

  it('TC-105-09: the item has all 5 available for E105-X again', async () => {
    const line = (await checkEquipmentAvailability(eventX, as(techSupport))).lines.find((l) => l.equipmentId === item);
    expect(line?.available).toBe(5);
  });

  it('TC-105-10: the ballroom has nothing committed at 10:00 to 12:00', async () => {
    expect(await getVenueCommitments(ballroom, `${D}T10:00`, `${D}T12:00`)).toEqual([]);
  });

  it('TC-105-12, TC-105-13, TC-105-14: the organiser, the Venue Staff, the Technical Support Staff and the attendee each get one notification', async () => {
    const notices = await notificationsFor(eventA);
    const recipients = notices.map((n) => n.recipient_id).sort();
    expect(recipients).toEqual(
      [organiser.userId, venueStaff.userId, techSupport.userId, attendee.userId].sort(),
    );
    for (const notice of notices) {
      expect(notice.message).toContain('has been cancelled and will not take place.');
    }
    expect(notices.find((n) => n.recipient_id === organiser.userId)?.message).toContain(`Reason: ${REASON}`);
  });

  it('TC-105-16: another coordinator searching those times finds the ballroom available', async () => {
    const found = await searchVenues({ date: D, start: '10:00', end: '12:00' });
    expect(found.venues.map((v) => v.id)).toContain(ballroom);
  });

  it('TC-105-17: each booking records the cause "Event cancelled", the coordinator and the time', async () => {
    const { data: bookings } = await admin
      .from('venue_booking')
      .select('release_reason, released_by, released_at')
      .eq('event_request_id', eventA);
    expect(bookings).toHaveLength(2);
    for (const booking of bookings ?? []) {
      expect(booking.release_reason).toBe('Event cancelled');
      expect(booking.released_by).toBe(coordinator.userId);
      expect(booking.released_at).not.toBeNull();
    }
    // The event's Venue bookings list (its booking history, CL-71) shows them.
    const { data: profile } = await admin.from('profiles').select('full_name').eq('id', coordinator.userId).single();
    const listed = await listEventVenueBookings(eventA, coordinator.userId);
    expect(listed).toHaveLength(2);
    for (const entry of listed) {
      expect(entry).toMatchObject({ status: 'released', releaseReason: 'Event cancelled', releasedByName: profile?.full_name });
      expect(entry.releasedAt).not.toBeNull();
    }
  });

  it('TC-105-18: the Venue Staff notification names each freed venue, date and times', async () => {
    const message = (await notificationsFor(eventA)).find((n) => n.recipient_id === venueStaff.userId)?.message ?? '';
    const [dd, mm, yyyy] = [D.slice(8, 10), D.slice(5, 7), D.slice(0, 4)];
    const next = addDays(D, 1);
    expect(message).toContain(`Marina Bay Ballroom ${RUN}, ${dd}/${mm}/${yyyy}, 10:00 to 12:00`);
    expect(message).toContain(`Bugis Seminar Room ${RUN}, ${next.slice(8, 10)}/${next.slice(5, 7)}/${next.slice(0, 4)}, 10:00 to 12:00`);
  });

  it('TC-105-19: a request that clashed with the cancelled booking can now be approved (SCRUM-155 AC3, D-15 replaced)', async () => {
    const decided = await decideVenueBookingRequest(otherRequest.requestId, venueStaff.userId, {
      decisions: [{ lineId: otherRequest.lineId, decision: 'approve' }],
    });
    expect(decided.status).toBe('approved');
  });
});

describe('AC3 (as read) and AC4 boundary', () => {
  it('TC-105-11: a Pending line is rejected with "Event cancelled" and no booking is made', async () => {
    const venue = await createTestVenue('Bugis Seminar Room E');
    const id = await createEvent('planning');
    const { lineId } = await requestLine(id, venue, day(40));

    await cancelEvent(id, as(coordinator), { reason: REASON });

    const { data: line } = await admin.from('venue_booking_request_line').select('status, rejection_reason').eq('id', lineId).single();
    expect(line).toEqual({ status: 'rejected', rejection_reason: 'Event cancelled' });
    const { data: bookings } = await admin.from('venue_booking').select('id').eq('event_request_id', id);
    expect(bookings).toEqual([]);
  });

  it('TC-105-15: with nothing arranged, only the organiser is told', async () => {
    const id = await createEvent('submitted');
    await cancelEvent(id, as(coordinator), { reason: 'Duplicate request' });
    expect((await notificationsFor(id)).map((n) => n.recipient_id)).toEqual([organiser.userId]);
  });
});
