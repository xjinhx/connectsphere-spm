import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createEquipmentItem } from '@/domain/equipment/service';
import { listEventReservations, reserveEquipment } from '@/domain/equipment-reservation/service';
import { updateEventInformation } from '@/domain/event-information/service';
import {
  AcknowledgementRequiredError,
  CHANGED_SINCE_READ_MESSAGE,
  changeEventSchedule,
  getEventSchedule,
  reconfirmArrangement,
} from '@/domain/significant-change/service';
import { decideVenueBookingRequest, listEventVenueBookings } from '@/domain/venue-booking/service';
import { createVenue } from '@/domain/venues/service';
import { ConflictError, ForbiddenError, NotFoundError } from '@/domain/shared/errors';
import { todayInSingapore } from '@/domain/shared/dates';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import { ensureTestClientOrganisation, TEST_CLIENT_ORGANISATION_ID } from './fixtures/clientOrganisation';

/**
 * SCRUM-111 Flag affected arrangements and mark them for review after a
 * significant change (Jira, authoritative; absorbs SCRUM-112):
 *   AC1, AC2 a change that affects an approved booking or reserved equipment
 *            is refused without the coordinator's acknowledgement;
 *   AC3 a descriptive change (SCRUM-110) flags nothing;
 *   AC4 a Confirmed event starting tomorrow can still change;
 *   AC5 an acknowledged change flags each affected arrangement with the time
 *       and the cause;
 *   AC6, AC7 the flag comes back with the booking and the reservation;
 *   AC9 the assigned coordinator re-confirms; who and when are saved.
 *
 * Runs against the local Supabase stack. Test case IDs are from the Sprint 4
 * sheet's SCRUM-111 tab (TC-111-nn); the pure rules and the routes are in
 * tests/unit/significant-change.test.ts.
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

let locationId: string;
let venueStaffId: string;
let technicalSupportId: string;
let coordinatorId: string;
let otherCoordinatorId: string;
let organiserId: string;
const venueIds: string[] = [];
const equipmentIds: string[] = [];
const eventIds: string[] = [];

function daysFromToday(days: number): string {
  const date = new Date(`${todayInSingapore()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** DD/MM/YYYY, as the cause names a date. */
const dmy = (date: string) => date.split('-').reverse().join('/');

async function createUser(label: string, roles: string[]): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label.toLowerCase().replace(/ /g, '-')}+flag${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  await admin.from('profiles').update({ roles, full_name: label } as never).eq('id', data.user.id);
  return data.user.id;
}

/** An event submitted, assigned to the coordinator, approved, then moved on to `status`. */
async function createEvent(
  status: EventRequestStatus,
  { date = daysFromToday(30), start = '10:00', end = '12:00', attendance = 150 } = {},
): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: TEST_CLIENT_ORGANISATION_ID,
      name: `S111 Event ${RUN}`,
      purpose: 'Client gala',
      description: 'Gala dinner',
      proposed_date: date,
      start_time: start,
      end_time: end,
      expected_attendance: attendance,
      room_layout: 'banquet',
      accessibility_required: false,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test event: ${error?.message}`);
  eventIds.push(data.id);
  const steps: Record<string, unknown>[] = [
    { status: 'submitted' },
    { coordinator_id: coordinatorId, assigned_by: coordinatorId },
    { status: 'approved', decision: 'approved', decided_by: coordinatorId },
  ];
  if (status !== 'approved') steps.push({ status: 'planning' });
  if (status !== 'approved' && status !== 'planning') steps.push({ status });
  for (const patch of steps) {
    const { error: stepError } = await admin.from('event_request').update(patch).eq('id', data.id);
    if (stepError) throw new Error(`could not prepare test event: ${stepError.message}`);
  }
  return data.id;
}

/** A venue booking made the real way (SCRUM-142 request, SCRUM-148 approval). Returns its id. */
async function book(eventId: string, date: string, start = '10:00', end = '12:00'): Promise<string> {
  const venue = await createVenue({ name: `S111 Marina Bay Ballroom ${RUN} ${venueIds.length}`, locationId, maxCapacity: 300 });
  venueIds.push(venue.id);
  const { data: requestId, error } = await admin.rpc('create_venue_booking_request', {
    p_event_request_id: eventId,
    p_venue_id: venue.id,
    p_requested_by: coordinatorId,
    p_lines: [{ date, start, end }],
  });
  if (error || !requestId) throw new Error(`could not create test request: ${error?.message}`);
  const { data: line } = await admin.from('venue_booking_request_line').select('id').eq('request_id', requestId).single();
  await decideVenueBookingRequest(requestId as string, venueStaffId, { decisions: [{ lineId: line!.id, decision: 'approve' }] });
  const { data: booking } = await admin.from('venue_booking').select('id').eq('event_request_id', eventId).single();
  return booking!.id;
}

/** Projector P-100 × 2 reserved for the event by Technical Support (SCRUM-173). Needs a booking first. */
async function reserveProjector(eventId: string): Promise<string> {
  const item = await createEquipmentItem(
    { name: `S111 Projector P-100 ${RUN} ${equipmentIds.length}`, category: 'av', quantity: 10, currentLocation: 'Bugis store room' },
    technicalSupportId,
  );
  equipmentIds.push(item.id);
  await admin.from('equipment_request').upsert({ event_request_id: eventId }, { onConflict: 'event_request_id' });
  const { data: line, error } = await admin
    .from('equipment_request_line')
    .insert({ event_request_id: eventId, equipment_id: item.id, quantity: 2, created_by: coordinatorId })
    .select('id')
    .single();
  if (error || !line) throw new Error(`could not add test line: ${error?.message}`);
  const reservation = await reserveEquipment(eventId, line.id, technicalSupportId, { quantity: 2 });
  return reservation.id;
}

async function eventRow(eventId: string) {
  const { data } = await admin
    .from('event_request')
    .select('status, proposed_date, start_time, end_time, expected_attendance')
    .eq('id', eventId)
    .single();
  return data!;
}

async function flagOf(table: 'venue_booking' | 'equipment_reservation', id: string) {
  const { data } = await admin
    .from(table)
    .select('review_required, review_required_at, review_required_cause, reconfirmed_by, reconfirmed_at')
    .eq('id', id)
    .single();
  return data!;
}

function change(date: string, extra: Record<string, unknown> = {}) {
  return { proposedDate: date, startTime: '10:00', endTime: '12:00', expectedAttendance: 150, roomLayout: 'banquet', accessibilityRequired: false, ...extra };
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  const { data: location, error } = await admin.from('locations').insert({ name: `S111 Location ${RUN}` }).select('id').single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;
  venueStaffId = await createUser('venue-staff', ['venue_staff']);
  technicalSupportId = await createUser('technical-support', ['technical_support']);
  coordinatorId = await createUser('Coordinator A', ['coordinator']);
  otherCoordinatorId = await createUser('coordinator-b', ['coordinator']);
  organiserId = await createUser('organiser', ['event_organiser']);
});

afterAll(async () => {
  // Events first: their requests, lines, bookings and reservations go with them (cascade).
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of equipmentIds) await admin.from('equipment').delete().eq('id', id);
  for (const id of venueIds) await admin.from('venues').delete().eq('id', id);
  for (const id of [venueStaffId, technicalSupportId, coordinatorId, otherCoordinatorId, organiserId]) {
    if (id) await admin.auth.admin.deleteUser(id);
  }
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
});

describe('SCRUM-111 AC1, AC2: an affected arrangement needs the acknowledgement', () => {
  it('SCRUM-111 AC1 TC-111-01 a new date names the booking and asks for acknowledgement', async () => {
    const date = daysFromToday(30);
    const eventId = await createEvent('planning', { date });
    await book(eventId, date);

    const refusal = changeEventSchedule(eventId, coordinatorId, change(daysFromToday(37), { acknowledged: false }));
    await expect(refusal).rejects.toBeInstanceOf(AcknowledgementRequiredError);
    await expect(refusal).rejects.toMatchObject({
      details: { acknowledgementRequired: true, bookings: [expect.stringContaining(`${dmy(date)}, 10:00–12:00`)], reservations: [] },
    });
  });

  it('SCRUM-111 AC1 TC-111-03 without the acknowledgement nothing is saved and nothing is flagged', async () => {
    const date = daysFromToday(30);
    const eventId = await createEvent('planning', { date });
    const bookingId = await book(eventId, date);

    await expect(changeEventSchedule(eventId, coordinatorId, change(daysFromToday(37)))).rejects.toBeInstanceOf(
      AcknowledgementRequiredError,
    );
    expect((await eventRow(eventId)).proposed_date).toBe(date);
    expect((await flagOf('venue_booking', bookingId)).review_required).toBe(false);
  });

  it('SCRUM-111 AC2 the equipment reservation needs the acknowledgement too', async () => {
    const date = daysFromToday(30);
    const eventId = await createEvent('planning', { date, start: '19:00', end: '22:00', attendance: 80 });
    await book(eventId, date, '19:00', '22:00');
    await reserveProjector(eventId);

    await expect(
      changeEventSchedule(eventId, coordinatorId, change(date, { startTime: '19:00', endTime: '23:00', expectedAttendance: 80 })),
    ).rejects.toMatchObject({ details: { reservations: [expect.stringContaining('× 2')] } });
  });
});

describe('SCRUM-111 AC3: a descriptive change flags nothing', () => {
  it('SCRUM-111 AC3 TC-111-06 SCRUM-110\'s save leaves every flag clear', async () => {
    const date = daysFromToday(30);
    const eventId = await createEvent('planning', { date });
    const bookingId = await book(eventId, date);

    await updateEventInformation(eventId, coordinatorId, { description: 'Gala dinner with awards' });
    expect((await flagOf('venue_booking', bookingId)).review_required).toBe(false);
  });

  it('SCRUM-111 AC3 saving the same schedule needs no acknowledgement and flags nothing', async () => {
    const date = daysFromToday(30);
    const eventId = await createEvent('planning', { date });
    const bookingId = await book(eventId, date);

    const result = await changeEventSchedule(eventId, coordinatorId, change(date));
    expect(result).toMatchObject({ flaggedBookings: 0, flaggedReservations: 0 });
    expect((await flagOf('venue_booking', bookingId)).review_required).toBe(false);
  });
});

describe('SCRUM-111 AC4: no cut-off', () => {
  it('SCRUM-111 AC4 TC-111-07 a Confirmed event starting tomorrow changes its times', async () => {
    const tomorrow = daysFromToday(1);
    const eventId = await createEvent('confirmed', { date: tomorrow });
    await book(eventId, tomorrow);

    const result = await changeEventSchedule(
      eventId,
      coordinatorId,
      change(tomorrow, { startTime: '14:00', endTime: '16:00', acknowledged: true }),
    );
    expect(result.flaggedBookings).toBe(1);
    expect(await eventRow(eventId)).toMatchObject({ status: 'confirmed', start_time: '14:00:00', end_time: '16:00:00' });
  });
});

describe('SCRUM-111 AC5-AC7: an acknowledged change flags every affected arrangement', () => {
  it('SCRUM-111 AC5 TC-111-08 the booking and the reservation are flagged with the time and the cause', async () => {
    const date = daysFromToday(30);
    const later = daysFromToday(37);
    const eventId = await createEvent('planning', { date });
    const bookingId = await book(eventId, date);
    const reservationId = await reserveProjector(eventId);
    const before = Date.now();

    const result = await changeEventSchedule(eventId, coordinatorId, change(later, { acknowledged: true }));

    expect(result).toMatchObject({ flaggedBookings: 1, flaggedReservations: 1 });
    expect((await eventRow(eventId)).proposed_date).toBe(later);
    for (const [table, id] of [['venue_booking', bookingId], ['equipment_reservation', reservationId]] as const) {
      const flag = await flagOf(table, id);
      expect(flag.review_required).toBe(true);
      expect(flag.review_required_cause).toBe(`Date changed from ${dmy(date)} to ${dmy(later)}`);
      expect(new Date(flag.review_required_at!).getTime()).toBeGreaterThanOrEqual(before - 5000);
    }
  });

  it('SCRUM-111 AC6 TC-111-09 the booking comes back with its flag, time and cause', async () => {
    const date = daysFromToday(30);
    const later = daysFromToday(37);
    const eventId = await createEvent('planning', { date });
    await book(eventId, date);
    await changeEventSchedule(eventId, coordinatorId, change(later, { acknowledged: true }));

    const [booking] = await listEventVenueBookings(eventId, coordinatorId);
    expect(booking).toMatchObject({
      reviewRequired: true,
      reviewRequiredAt: expect.any(String),
      reviewRequiredCause: `Date changed from ${dmy(date)} to ${dmy(later)}`,
    });
  });

  it('SCRUM-111 AC7 TC-111-10 the reservation comes back with its flag, time and cause', async () => {
    const date = daysFromToday(30);
    const eventId = await createEvent('planning', { date, start: '19:00', end: '22:00', attendance: 80 });
    await book(eventId, date, '19:00', '22:00');
    await reserveProjector(eventId);
    await changeEventSchedule(
      eventId,
      coordinatorId,
      change(date, { startTime: '19:00', endTime: '23:00', expectedAttendance: 80, acknowledged: true }),
    );

    const { reservations } = await listEventReservations(eventId, { userId: coordinatorId, roles: ['coordinator'] });
    expect(reservations[0]).toMatchObject({
      reviewRequired: true,
      reviewRequiredAt: expect.any(String),
      reviewRequiredCause: 'Times changed from 19:00–22:00 to 19:00–23:00',
    });
  });

  it('SCRUM-111 AC5 an attendance-only change flags the booking but not the reservation', async () => {
    const date = daysFromToday(30);
    const eventId = await createEvent('planning', { date });
    const bookingId = await book(eventId, date);
    const reservationId = await reserveProjector(eventId);

    await changeEventSchedule(eventId, coordinatorId, change(date, { expectedAttendance: 180, acknowledged: true }));
    expect((await flagOf('venue_booking', bookingId)).review_required_cause).toBe('Expected attendance changed from 150 to 180');
    expect((await flagOf('equipment_reservation', reservationId)).review_required).toBe(false);
  });
});

describe('SCRUM-111 AC8, AC9: re-confirming', () => {
  it('SCRUM-111 AC9 TC-111-11 the assigned coordinator re-confirms: flag cleared, who and when saved', async () => {
    const date = daysFromToday(30);
    const eventId = await createEvent('planning', { date });
    const bookingId = await book(eventId, date);
    await changeEventSchedule(eventId, coordinatorId, change(daysFromToday(37), { acknowledged: true }));

    const summary = await reconfirmArrangement(eventId, coordinatorId, { kind: 'venue_booking', id: bookingId });

    expect(summary).toMatchObject({ reviewRequired: false, reconfirmedByName: 'Coordinator A', reconfirmedAt: expect.any(String) });
    const flag = await flagOf('venue_booking', bookingId);
    expect(flag).toMatchObject({ review_required: false, reconfirmed_by: coordinatorId });
    expect(flag.reconfirmed_at).not.toBeNull();
  });

  it('SCRUM-111 AC9 TC-111-12 a coordinator not assigned to the event cannot re-confirm; the flag stays', async () => {
    const date = daysFromToday(30);
    const eventId = await createEvent('planning', { date });
    const bookingId = await book(eventId, date);
    await changeEventSchedule(eventId, coordinatorId, change(daysFromToday(37), { acknowledged: true }));

    await expect(
      reconfirmArrangement(eventId, otherCoordinatorId, { kind: 'venue_booking', id: bookingId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await flagOf('venue_booking', bookingId)).review_required).toBe(true);
  });

  it('SCRUM-111 AC8 once every affected arrangement is re-confirmed, none is flagged', async () => {
    const date = daysFromToday(30);
    const eventId = await createEvent('planning', { date });
    const bookingId = await book(eventId, date);
    const reservationId = await reserveProjector(eventId);
    await changeEventSchedule(eventId, coordinatorId, change(daysFromToday(37), { acknowledged: true }));

    await reconfirmArrangement(eventId, coordinatorId, { kind: 'venue_booking', id: bookingId });
    let view = await getEventSchedule(eventId, { userId: coordinatorId, roles: ['coordinator'] });
    expect([...view.bookings, ...view.reservations].filter((item) => item.reviewRequired)).toHaveLength(1);

    await reconfirmArrangement(eventId, coordinatorId, { kind: 'equipment_reservation', id: reservationId });
    view = await getEventSchedule(eventId, { userId: coordinatorId, roles: ['coordinator'] });
    expect([...view.bookings, ...view.reservations].some((item) => item.reviewRequired)).toBe(false);
  });

  it('refuses an arrangement that is not flagged (409) or not this event\'s (404)', async () => {
    const date = daysFromToday(30);
    const eventId = await createEvent('planning', { date });
    const bookingId = await book(eventId, date);
    const otherEventId = await createEvent('planning', { date });

    await expect(reconfirmArrangement(eventId, coordinatorId, { kind: 'venue_booking', id: bookingId })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(
      reconfirmArrangement(otherEventId, coordinatorId, { kind: 'venue_booking', id: bookingId }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('SCRUM-111: who may change, and when', () => {
  it('refuses a coordinator the event is not assigned to, and saves nothing', async () => {
    const date = daysFromToday(30);
    const eventId = await createEvent('planning', { date });
    await expect(
      changeEventSchedule(eventId, otherCoordinatorId, change(daysFromToday(37), { acknowledged: true })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await eventRow(eventId)).proposed_date).toBe(date);
  });

  it('refuses a Completed or Cancelled event (SCRUM-110 AC5)', async () => {
    for (const status of ['completed', 'cancelled'] as const) {
      const date = daysFromToday(30);
      const eventId = await createEvent(status, { date });
      await expect(
        changeEventSchedule(eventId, coordinatorId, change(daysFromToday(37), { acknowledged: true })),
      ).rejects.toBeInstanceOf(ConflictError);
      expect((await eventRow(eventId)).proposed_date).toBe(date);
    }
  });

  it('refuses a save when the event changed after it was read, so the cause is never stale', async () => {
    const date = daysFromToday(30);
    const eventId = await createEvent('planning', { date });
    await book(eventId, date);
    // A change made between the service's read and the write: the database
    // function is called with an updated_at that no longer matches.
    const { data: before } = await admin.from('event_request').select('updated_at').eq('id', eventId).single();
    await admin.from('event_request').update({ expected_attendance: 151 }).eq('id', eventId);
    const { data } = await admin.rpc('change_event_schedule', {
      p_event_request_id: eventId,
      p_coordinator_id: coordinatorId,
      p_expected_updated_at: before!.updated_at,
      p_proposed_date: daysFromToday(37),
      p_start_time: '10:00',
      p_end_time: '12:00',
      p_expected_attendance: 150,
      p_room_layout: 'banquet',
      p_accessibility_required: false,
      p_accessibility_notes: null as unknown as string,
      p_booking_cause: 'stale',
      p_reservation_cause: null as unknown as string,
      p_acknowledged: true,
    });
    expect(data).toEqual({ outcome: 'changed' });
    expect(CHANGED_SINCE_READ_MESSAGE).toMatch(/Reload the page/);
  });
});
