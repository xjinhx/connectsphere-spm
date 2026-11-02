import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createEquipmentItem } from '@/domain/equipment/service';
import { reserveEquipment } from '@/domain/equipment-reservation/service';
import { recordEssentialArrangements } from '@/domain/essential-arrangements/service';
import { cancelEvent, confirmEvent } from '@/domain/event-status/service';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import { approveChangeRequest, raiseChangeRequest } from '@/domain/change-request/service';
import { registerForEvent } from '@/domain/event-registration/service';
import { reconfirmArrangement } from '@/domain/significant-change/service';
import { decideVenueBookingRequest } from '@/domain/venue-booking/service';
import { createVenue } from '@/domain/venues/service';
import { ConflictError, ForbiddenError } from '@/domain/shared/errors';
import { todayInSingapore } from '@/domain/shared/dates';
import { ensureTestClientOrganisation, TEST_CLIENT_ORGANISATION_ID } from './fixtures/clientOrganisation';

/**
 * SCRUM-190 — Approve a change request and apply it (Jira, authoritative).
 *
 * Runs against the local Supabase stack. Test case IDs are from the Sprint 4
 * sheet's SCRUM-190 tab (TC-190-nn): a happy path per AC, a boundary case for
 * AC2 (TC-190-07, a non-significant change never drops a Confirmed event) and
 * negative cases (TC-190-08, a non-Pending request; TC-190-09, a request on
 * an event cancelled since it was raised). The pure rules are in
 * tests/unit/approve-change-request-policy.test.ts.
 *
 * AC5: a registration belongs to the signed-in Attendee account that made it
 * (SCRUM-181), so the attendee is registered for real (registerForEvent) and
 * their in-app notification is read back.
 */

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

let locationId: string;
let venueStaffId: string;
let technicalSupportId: string;
let coordinatorId: string;
let otherCoordinatorId: string;
let organiserId: string;
let attendeeId: string;
const venueIds: string[] = [];
const equipmentIds: string[] = [];
const eventIds: string[] = [];
const userIds: string[] = [];

function daysFromToday(days: number): string {
  const date = new Date(`${todayInSingapore()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createUser(label: string, roles: string[]): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label.toLowerCase().replace(/ /g, '-')}+s190${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  await admin.from('profiles').update({ roles, full_name: label, client_organisation_id: TEST_CLIENT_ORGANISATION_ID } as never).eq('id', data.user.id);
  userIds.push(data.user.id);
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
      name: `S190 Event ${RUN}`,
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

/** A venue booking made the real way (request raised, approved by Venue Staff). Returns its id. */
async function book(eventId: string, date: string, start = '10:00', end = '12:00'): Promise<string> {
  const venue = await createVenue({ name: `S190 Venue ${RUN} ${venueIds.length}`, locationId, maxCapacity: 300 });
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

/** Projector P-100 × 2 reserved for the event by Technical Support. Needs a booking first. */
async function reserveProjector(eventId: string): Promise<string> {
  const item = await createEquipmentItem(
    { name: `S190 Projector ${RUN} ${equipmentIds.length}`, category: 'av', quantity: 10, currentLocation: 'Bugis store room' },
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

async function markEssential(eventId: string, essential: { venue?: 'essential' | 'not_required'; equipment?: 'essential' | 'not_required' }) {
  await recordEssentialArrangements(eventId, coordinatorId, {
    venue: 'not_required',
    equipment: 'not_required',
    technicalSupport: 'not_required',
    registration: 'not_required',
    ...essential,
  });
}

async function eventRow(eventId: string) {
  const { data } = await admin
    .from('event_request')
    .select('status, name, description, proposed_date, expected_attendance')
    .eq('id', eventId)
    .single();
  return data!;
}

async function flagOf(table: 'venue_booking' | 'equipment_reservation', id: string) {
  const { data } = await admin.from(table).select('review_required').eq('id', id).single();
  return data!.review_required as boolean;
}

async function changeRequestRow(id: string) {
  const { data } = await admin.from('change_request').select('status, decided_by, decided_at').eq('id', id).single();
  return data!;
}

async function notificationsFor(recipientId: string, eventRequestId: string, type: string) {
  const { data, error } = await admin
    .from('notifications')
    .select('type, message')
    .eq('recipient_id', recipientId)
    .eq('event_request_id', eventRequestId)
    .eq('type', type);
  if (error) throw new Error(`could not read test notifications: ${error.message}`);
  return data ?? [];
}

const asCoordinator = () => ({ userId: coordinatorId, roles: ['coordinator'] as const });

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  const { data: location, error } = await admin.from('locations').insert({ name: `S190 Location ${RUN}` }).select('id').single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;
  venueStaffId = await createUser('venue-staff', ['venue_staff']);
  technicalSupportId = await createUser('technical-support', ['technical_support']);
  coordinatorId = await createUser('Coordinator A', ['coordinator']);
  otherCoordinatorId = await createUser('coordinator-b', ['coordinator']);
  organiserId = await createUser('organiser', ['event_organiser']);
  attendeeId = await createUser('attendee', ['attendee']);
});

afterAll(async () => {
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of equipmentIds) await admin.from('equipment').delete().eq('id', id);
  for (const id of venueIds) await admin.from('venues').delete().eq('id', id);
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
});

describe('SCRUM-190 AC1: approving a Pending request applies the values', () => {
  it('TC-190-01 applies the proposed value and flips the request to Approved', async () => {
    const eventId = await createEvent('planning');
    const cr = await raiseChangeRequest(
      eventId,
      { fields: [{ field: 'expectedAttendance', proposedValue: 200 }], reason: 'More guests confirmed' },
      organiserId,
    );

    const outcome = await approveChangeRequest(eventId, cr.id, coordinatorId);

    expect(outcome.status).toBe('approved');
    expect((await eventRow(eventId)).expected_attendance).toBe(200);
    const row = await changeRequestRow(cr.id);
    expect(row.status).toBe('approved');
    expect(row.decided_by).toBe(coordinatorId);
    expect(row.decided_at).not.toBeNull();
  });

  it('applies name, accessibility features and the equipment item list together', async () => {
    const eventId = await createEvent('planning');
    const { data: features } = await admin.from('accessibility_features').select('id').limit(2);
    const featureIds = (features ?? []).map((f) => f.id as string);

    const cr = await raiseChangeRequest(
      eventId,
      {
        fields: [
          { field: 'name', proposedValue: 'S190 Event Renamed' },
          { field: 'accessibilityRequired', proposedValue: true },
          { field: 'accessibilityFeatureIds', proposedValue: featureIds },
          { field: 'equipmentItems', proposedValue: [{ item: 'Microphone', quantity: 3 }] },
        ],
        reason: 'Client asked for accessible seating and a mic',
      },
      organiserId,
    );

    await approveChangeRequest(eventId, cr.id, coordinatorId);

    expect((await eventRow(eventId)).name).toBe('S190 Event Renamed');
    const { data: linked } = await admin.from('event_request_accessibility_features').select('accessibility_feature_id').eq('event_request_id', eventId);
    expect((linked ?? []).map((l) => l.accessibility_feature_id).sort()).toEqual([...featureIds].sort());
    const { data: items } = await admin.from('event_request_equipment').select('item, quantity').eq('event_request_id', eventId);
    expect(items).toEqual([{ item: 'Microphone', quantity: 3 }]);
  });

  it('refuses a coordinator the event is not assigned to, and applies nothing', async () => {
    const eventId = await createEvent('planning');
    const cr = await raiseChangeRequest(
      eventId,
      { fields: [{ field: 'expectedAttendance', proposedValue: 200 }], reason: 'More guests confirmed' },
      organiserId,
    );

    await expect(approveChangeRequest(eventId, cr.id, otherCoordinatorId)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await eventRow(eventId)).expected_attendance).toBe(150);
  });
});

describe('SCRUM-190 AC2, AC3: a significant change returns a Confirmed event to Planning, gated by essential + flagged', () => {
  it('TC-190-02 returns the event to Planning; it cannot be re-confirmed until the essential flagged booking is re-confirmed', async () => {
    const date = daysFromToday(40);
    const eventId = await createEvent('planning', { date });
    await markEssential(eventId, { venue: 'essential' });
    const bookingId = await book(eventId, date);

    await confirmEvent(eventId, asCoordinator());
    expect((await eventRow(eventId)).status).toBe('confirmed');

    const later = daysFromToday(55);
    const cr = await raiseChangeRequest(eventId, { fields: [{ field: 'proposedDate', proposedValue: later }], reason: 'Venue only free later' }, organiserId);
    await approveChangeRequest(eventId, cr.id, coordinatorId);

    expect((await eventRow(eventId)).status).toBe('planning');
    expect(await flagOf('venue_booking', bookingId)).toBe(true);

    await expect(confirmEvent(eventId, asCoordinator())).rejects.toMatchObject({
      details: { outstanding: [expect.stringContaining('is marked for review')] },
    });

    await reconfirmArrangement(eventId, coordinatorId, { kind: 'venue_booking', id: bookingId });
    const confirmed = await confirmEvent(eventId, asCoordinator());
    expect(confirmed.status).toBe('confirmed');
  });

  it('TC-190-03 a flagged arrangement that is not marked essential never blocks re-confirmation', async () => {
    const date = daysFromToday(41);
    const eventId = await createEvent('planning', { date });
    await markEssential(eventId, { venue: 'essential', equipment: 'not_required' });
    const bookingId = await book(eventId, date);
    const reservationId = await reserveProjector(eventId);

    await confirmEvent(eventId, asCoordinator());

    const later = daysFromToday(56);
    const cr = await raiseChangeRequest(eventId, { fields: [{ field: 'proposedDate', proposedValue: later }], reason: 'Venue only free later' }, organiserId);
    await approveChangeRequest(eventId, cr.id, coordinatorId);

    // Both the booking (essential) and the reservation (not essential) are flagged by the date change...
    expect(await flagOf('venue_booking', bookingId)).toBe(true);
    expect(await flagOf('equipment_reservation', reservationId)).toBe(true);

    // ...but only the booking blocks, and only it is named.
    const refusal = await confirmEvent(eventId, asCoordinator()).then(
      () => { throw new Error('expected a refusal'); },
      (caught: unknown) => caught as ConflictError,
    );
    const outstanding = (refusal.details as { outstanding: string[] }).outstanding;
    expect(outstanding.some((line) => line.startsWith('Venue:'))).toBe(true);
    expect(outstanding.some((line) => line.startsWith('Equipment:'))).toBe(false);

    await reconfirmArrangement(eventId, coordinatorId, { kind: 'venue_booking', id: bookingId });
    const confirmed = await confirmEvent(eventId, asCoordinator());
    expect(confirmed.status).toBe('confirmed');
    // The reservation is still flagged — confirming never clears it, and it was never essential.
    expect(await flagOf('equipment_reservation', reservationId)).toBe(true);
  });

  it('TC-190-07 (boundary) a non-significant change never drops a Confirmed event to Planning', async () => {
    const eventId = await createEvent('planning');
    await confirmEvent(eventId, asCoordinator());

    const cr = await raiseChangeRequest(eventId, { fields: [{ field: 'description', proposedValue: 'Updated description only' }], reason: 'Wording only' }, organiserId);
    await approveChangeRequest(eventId, cr.id, coordinatorId);

    expect((await eventRow(eventId)).status).toBe('confirmed');
    expect((await eventRow(eventId)).description).toBe('Updated description only');
  });
});

describe('SCRUM-190 AC4: affected arrangements are flagged and the staff who actioned them are notified', () => {
  it('TC-190-04 flags the affected booking and reservation, and notifies the Venue Staff and Technical Support who actioned them', async () => {
    const date = daysFromToday(42);
    const eventId = await createEvent('planning', { date });
    const bookingId = await book(eventId, date);
    const reservationId = await reserveProjector(eventId);

    const later = daysFromToday(57);
    const cr = await raiseChangeRequest(eventId, { fields: [{ field: 'proposedDate', proposedValue: later }], reason: 'Date needs to move' }, organiserId);
    await approveChangeRequest(eventId, cr.id, coordinatorId);

    expect(await flagOf('venue_booking', bookingId)).toBe(true);
    expect(await flagOf('equipment_reservation', reservationId)).toBe(true);

    const venueNotices = await notificationsFor(venueStaffId, eventId, 'arrangement_needs_review');
    const equipmentNotices = await notificationsFor(technicalSupportId, eventId, 'arrangement_needs_review');
    expect(venueNotices).toHaveLength(1);
    expect(equipmentNotices).toHaveLength(1);

    // Each message says what changed on the arrangement that person actioned,
    // since it opens no event page (they can't open the organiser's).
    const [venueNotice] = venueNotices;
    const [equipmentNotice] = equipmentNotices;
    expect(venueNotice?.message).toContain('Venue booking: Date changed');
    expect(venueNotice?.message).not.toContain('Equipment reservation');
    expect(equipmentNotice?.message).toContain('Equipment reservation: Date changed');
    expect(equipmentNotice?.message).not.toContain('Venue booking');
  });
});

describe('SCRUM-190 AC5: registered attendees are notified of the new details', () => {
  /** Registration open from yesterday with places left, as SCRUM-185 AC5 would set it. */
  async function registerAttendee(eventId: string) {
    const { error } = await admin
      .from('event_request')
      .update({ registration_start_date: daysFromToday(-1), registration_end_date: daysFromToday(20), registration_capacity: 50 })
      .eq('id', eventId);
    if (error) throw new Error(`could not open registration: ${error.message}`);
    await registerForEvent(eventId, attendeeId, { fullName: 'Tan Mei Ling', email: 'mei.ling@example.com', contactNumber: '+65 9123 4567' });
  }

  it('TC-190-05 tells each registered attendee the new date and times', async () => {
    const eventId = await createEvent('planning');
    await registerAttendee(eventId);
    const later = daysFromToday(44);
    const cr = await raiseChangeRequest(
      eventId,
      {
        fields: [
          { field: 'proposedDate', proposedValue: later },
          { field: 'startTime', proposedValue: '11:00' },
          { field: 'endTime', proposedValue: '13:00' },
        ],
        reason: 'Venue moved the date',
      },
      organiserId,
    );

    await approveChangeRequest(eventId, cr.id, coordinatorId);

    const notifications = await notificationsFor(attendeeId, eventId, 'event_details_changed');
    expect(notifications).toHaveLength(1);
    const [notification] = notifications;
    expect(notification?.message).toContain(later.split('-').reverse().join('/'));
    expect(notification?.message).toContain('11:00–13:00');
  });

  it('TC-190-05 tells attendees nothing when nothing they are shown changed (attendance only)', async () => {
    const eventId = await createEvent('planning');
    await registerAttendee(eventId);
    const cr = await raiseChangeRequest(eventId, { fields: [{ field: 'expectedAttendance', proposedValue: 175 }], reason: 'A few more guests' }, organiserId);

    await approveChangeRequest(eventId, cr.id, coordinatorId);

    expect(await notificationsFor(attendeeId, eventId, 'event_details_changed')).toHaveLength(0);
  });
});

describe('SCRUM-190 AC6: the organiser who raised it is notified', () => {
  it('TC-190-06 notifies the organiser that their change request was approved', async () => {
    const eventId = await createEvent('planning');
    const cr = await raiseChangeRequest(eventId, { fields: [{ field: 'expectedAttendance', proposedValue: 175 }], reason: 'A few more guests' }, organiserId);

    await approveChangeRequest(eventId, cr.id, coordinatorId);

    const notifications = await notificationsFor(organiserId, eventId, 'change_request_approved');
    expect(notifications).toHaveLength(1);
  });
});

describe('SCRUM-190: a change request that is not Pending cannot be approved', () => {
  it('TC-190-08 (negative) refuses a request that has already been decided', async () => {
    const eventId = await createEvent('planning');
    const cr = await raiseChangeRequest(eventId, { fields: [{ field: 'expectedAttendance', proposedValue: 175 }], reason: 'A few more guests' }, organiserId);
    await approveChangeRequest(eventId, cr.id, coordinatorId);

    await expect(approveChangeRequest(eventId, cr.id, coordinatorId)).rejects.toBeInstanceOf(ConflictError);
  });

  // Supplementary (review on PR #164): SCRUM-110 AC5 makes a Completed or
  // Cancelled event read-only, so a request raised before the event was
  // cancelled (SCRUM-105) can no longer be approved.
  it('TC-190-09 (negative) refuses a Pending request once its event is cancelled, and changes nothing', async () => {
    const eventId = await createEvent('planning');
    const cr = await raiseChangeRequest(eventId, { fields: [{ field: 'expectedAttendance', proposedValue: 175 }], reason: 'A few more guests' }, organiserId);
    const attendanceBefore = (await eventRow(eventId)).expected_attendance;
    await cancelEvent(eventId, asCoordinator(), { reason: 'The client has withdrawn' });

    await expect(approveChangeRequest(eventId, cr.id, coordinatorId)).rejects.toThrow(
      'This event is Cancelled. Its record is read-only and kept as history.',
    );

    const event = await eventRow(eventId);
    expect(event.status).toBe('cancelled');
    expect(event.expected_attendance).toBe(attendanceBefore);
    expect((await changeRequestRow(cr.id)).status).toBe('pending');
    expect(await notificationsFor(organiserId, eventId, 'change_request_approved')).toHaveLength(0);
  });
});
