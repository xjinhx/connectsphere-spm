import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));

import { getCurrentActor, type Actor } from '@/lib/auth/currentActor';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEventInformation, updateEventInformation } from '@/domain/event-information/service';
import { getEventRequest, updateEventRequestDraft } from '@/domain/event-request/service';
import { decideVenueBookingRequest } from '@/domain/venue-booking/service';
import { createVenue } from '@/domain/venues/service';
import { ConflictError, ForbiddenError, InvalidTransitionError, ValidationError } from '@/domain/shared/errors';
import { todayInSingapore } from '@/domain/shared/dates';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-110 Edit ordinary event information (Jira, authoritative):
 *   AC1 the assigned coordinator of an event that is not Cancelled or Completed
 *       saves description, internal notes and client contact; no arrangement is
 *       flagged for review;
 *   AC2-AC4 the organiser side: the responsible organiser of a submitted event
 *       cannot edit, a colleague can view only, another organisation is denied;
 *   AC5 a Completed or Cancelled event is read-only and stays viewable.
 *
 * Runs against the local Supabase stack. Test case IDs are from the Sprint 4
 * sheet's SCRUM-110 tab (TC-110-nn). Route-level role refusals are in
 * tests/unit/event-information.test.ts. The session is the only thing replaced
 * (getCurrentActor), for the organiser-side reads that take it from there.
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_ORGANISATION_ID = '44444444-4444-4444-4444-444444444444';

const TC_110_01_DATA = {
  description: 'Annual client gala dinner',
  internalNotes: 'VIP table near stage',
  clientContactName: 'Mei Tan',
  clientContactEmail: 'mei.tan@harbourevents.sg',
  clientContactPhone: '+65 9123 4567',
};

let locationId: string;
let venueStaffId: string;
let coordinatorId: string;
let otherCoordinatorId: string;
let organiserId: string;
let colleagueId: string;
let otherOrganiserId: string;
const venueIds: string[] = [];
const eventIds: string[] = [];

function daysFromToday(days: number): string {
  const date = new Date(`${todayInSingapore()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+info${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  return data.user.id;
}

function signInAs(userId: string, clientOrganisationId: string | null, roles: Actor['roles'] = ['event_organiser']) {
  vi.mocked(getCurrentActor).mockResolvedValue({
    userId,
    fullName: 'Test',
    roles,
    clientOrganisation: clientOrganisationId ? { id: clientOrganisationId, name: 'Test organisation' } : null,
  });
}

/** An event submitted by the organiser, assigned to the coordinator, then moved on to `status`. */
async function createEvent(status: EventRequestStatus, date = daysFromToday(30)): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: CLIENT_ORGANISATION_ID,
      name: `S110 Harbour Gala ${RUN}`,
      purpose: 'Client gala',
      description: 'Gala dinner',
      proposed_date: date,
      start_time: '10:00',
      end_time: '12:00',
      expected_attendance: 150,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test event: ${error?.message}`);
  eventIds.push(data.id);
  if (status === 'draft') return data.id;
  const steps: Record<string, unknown>[] = [{ status: 'submitted' }, { coordinator_id: coordinatorId, assigned_by: coordinatorId }];
  if (status !== 'submitted') {
    steps.push({ status: 'approved', decision: 'approved', decided_by: coordinatorId });
    if (status !== 'approved') steps.push({ status });
  }
  for (const patch of steps) {
    const { error: stepError } = await admin.from('event_request').update(patch).eq('id', data.id);
    if (stepError) throw new Error(`could not prepare test event: ${stepError.message}`);
  }
  return data.id;
}

/** A venue booking made the real way (SCRUM-142 request, SCRUM-148 approval). Returns its id. */
async function book(eventId: string, date: string): Promise<string> {
  const venue = await createVenue({ name: `S110 Marina Bay ${RUN}`, locationId, maxCapacity: 300 });
  venueIds.push(venue.id);
  const { data: requestId, error } = await admin.rpc('create_venue_booking_request', {
    p_event_request_id: eventId,
    p_venue_id: venue.id,
    p_requested_by: coordinatorId,
    p_lines: [{ date, start: '10:00', end: '12:00' }],
  });
  if (error || !requestId) throw new Error(`could not create test request: ${error?.message}`);
  const { data: line } = await admin.from('venue_booking_request_line').select('id').eq('request_id', requestId).single();
  await decideVenueBookingRequest(requestId as string, venueStaffId, { decisions: [{ lineId: line!.id, decision: 'approve' }] });
  const { data: booking } = await admin.from('venue_booking').select('id').eq('event_request_id', eventId).single();
  return booking!.id;
}

async function eventRow(eventId: string) {
  const { data } = await admin
    .from('event_request')
    .select(
      'status, proposed_date, start_time, end_time, expected_attendance, description, internal_notes, ' +
        'client_contact_name, client_contact_email, client_contact_phone',
    )
    .eq('id', eventId)
    .single();
  return data as unknown as Record<string, unknown>;
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  await admin.from('client_organisations').upsert({ id: OTHER_ORGANISATION_ID, name: `Lion City Conferences ${RUN}` });
  const { data: location, error } = await admin.from('locations').insert({ name: `S110 Location ${RUN}` }).select('id').single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;
  venueStaffId = await createUser('venue-staff');
  coordinatorId = await createUser('coordinator');
  otherCoordinatorId = await createUser('coordinator-b');
  organiserId = await createUser('organiser');
  colleagueId = await createUser('organiser-colleague');
  otherOrganiserId = await createUser('organiser-other');
});

afterAll(async () => {
  // Events first: their requests, lines and bookings go with them (cascade).
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of venueIds) await admin.from('venues').delete().eq('id', id);
  for (const id of [venueStaffId, coordinatorId, otherCoordinatorId, organiserId, colleagueId, otherOrganiserId]) {
    if (id) await admin.auth.admin.deleteUser(id);
  }
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
  await admin.from('client_organisations').delete().eq('id', OTHER_ORGANISATION_ID);
});

beforeEach(() => {
  vi.mocked(getCurrentActor).mockReset();
});

describe('SCRUM-110 AC1: the assigned coordinator saves the five fields', () => {
  it('SCRUM-110 AC1 TC-110-01 stores them and leaves the booking and the schedule untouched', async () => {
    const date = daysFromToday(30);
    const eventId = await createEvent('planning', date);
    const bookingId = await book(eventId, date);
    const { data: bookingBefore } = await admin.from('venue_booking').select('*').eq('id', bookingId).single();
    const before = await eventRow(eventId);

    const saved = await updateEventInformation(eventId, coordinatorId, TC_110_01_DATA);

    expect(saved).toEqual(TC_110_01_DATA);
    const after = await eventRow(eventId);
    expect(after).toMatchObject({
      description: TC_110_01_DATA.description,
      internal_notes: TC_110_01_DATA.internalNotes,
      client_contact_name: TC_110_01_DATA.clientContactName,
      client_contact_email: TC_110_01_DATA.clientContactEmail,
      client_contact_phone: TC_110_01_DATA.clientContactPhone,
    });
    // Nothing that affects an arrangement changed, and the booking row is
    // exactly as it was: no flag, no status change (AC1).
    for (const column of ['status', 'proposed_date', 'start_time', 'end_time', 'expected_attendance']) {
      expect(after[column]).toEqual(before[column]);
    }
    const { data: bookingAfter } = await admin.from('venue_booking').select('*').eq('id', bookingId).single();
    expect(bookingAfter).toEqual(bookingBefore);

    // What the coordinator's page reads back after a reload.
    const view = await getEventInformation(eventId, { userId: coordinatorId, roles: ['coordinator'] });
    expect(view).toMatchObject({ ...TC_110_01_DATA, canEdit: true, readOnlyReason: null });
  });

  it('SCRUM-110 AC1 TC-110-02 edits a Confirmed event; a cleared field is stored as null', async () => {
    const eventId = await createEvent('confirmed');
    await updateEventInformation(eventId, coordinatorId, TC_110_01_DATA);

    await updateEventInformation(eventId, coordinatorId, {
      ...TC_110_01_DATA,
      description: 'Dinner moved to the terrace',
      internalNotes: '',
    });

    expect(await eventRow(eventId)).toMatchObject({
      status: 'confirmed',
      description: 'Dinner moved to the terrace',
      internal_notes: null,
    });
  });

  it('SCRUM-110 AC1 TC-110-03 refuses a coordinator who is not assigned, and nothing changes', async () => {
    const eventId = await createEvent('planning');
    await expect(
      updateEventInformation(eventId, otherCoordinatorId, { ...TC_110_01_DATA, description: 'Changed by another coordinator' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await eventRow(eventId)).description).toBe('Gala dinner');
    // They cannot read the internal notes either.
    await expect(getEventInformation(eventId, { userId: otherCoordinatorId, roles: ['coordinator'] })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('SCRUM-110 AC1 TC-110-04 refuses an invalid email, naming the field, and keeps the earlier values', async () => {
    const eventId = await createEvent('planning');
    await updateEventInformation(eventId, coordinatorId, TC_110_01_DATA);

    const attempt = updateEventInformation(eventId, coordinatorId, {
      ...TC_110_01_DATA,
      clientContactName: 'Someone Else',
      clientContactEmail: 'mei.tan.harbourevents',
    });
    await expect(attempt).rejects.toBeInstanceOf(ValidationError);
    await attempt.catch((error: ValidationError) => {
      expect(Object.keys((error.details as { fieldErrors: object }).fieldErrors)).toEqual(['clientContactEmail']);
    });
    expect(await eventRow(eventId)).toMatchObject({
      client_contact_name: 'Mei Tan',
      client_contact_email: 'mei.tan@harbourevents.sg',
    });
  });

  it('lets the Event Coordinator Lead see the information, without the edit action', async () => {
    const eventId = await createEvent('planning');
    const view = await getEventInformation(eventId, { userId: otherCoordinatorId, roles: ['operations_manager'] });
    expect(view.canEdit).toBe(false);
  });
});

describe('SCRUM-110 AC2-AC4: the organiser side', () => {
  it('SCRUM-110 AC2 TC-110-05 never gives the responsible organiser the internal information', async () => {
    const eventId = await createEvent('planning');
    await expect(getEventInformation(eventId, { userId: organiserId, roles: ['event_organiser'] })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('SCRUM-110 AC2 TC-110-06 refuses the organiser saving a submitted request, and nothing changes', async () => {
    const eventId = await createEvent('planning');
    signInAs(organiserId, CLIENT_ORGANISATION_ID);
    await expect(
      updateEventRequestDraft(eventId, { name: 'S110 Harbour Gala', description: 'Changed by the organiser' }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
    expect((await eventRow(eventId)).description).toBe('Gala dinner');
  });

  it('SCRUM-110 AC3 TC-110-08 lets a same-organisation colleague view the request', async () => {
    const eventId = await createEvent('planning');
    signInAs(colleagueId, CLIENT_ORGANISATION_ID);
    await expect(getEventRequest(eventId)).resolves.toMatchObject({ id: eventId });
  });

  it('SCRUM-110 AC4 TC-110-09 denies an organiser from another organisation', async () => {
    const eventId = await createEvent('planning');
    signInAs(otherOrganiserId, OTHER_ORGANISATION_ID);
    await expect(getEventRequest(eventId)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('SCRUM-110 AC5: a Completed or Cancelled event is history', () => {
  it('SCRUM-110 AC5 TC-110-10 shows a Completed event read-only and still viewable', async () => {
    const eventId = await createEvent('completed');
    const view = await getEventInformation(eventId, { userId: coordinatorId, roles: ['coordinator'] });
    expect(view.canEdit).toBe(false);
    expect(view.readOnlyReason).toMatch(/Completed\. Its record is read-only and kept as history/);
    signInAs(organiserId, CLIENT_ORGANISATION_ID);
    await expect(getEventRequest(eventId)).resolves.toMatchObject({ status: 'completed' });
  });

  it.each<EventRequestStatus>(['cancelled', 'completed'])(
    'SCRUM-110 AC5 TC-110-11 refuses a save on a %s event, and nothing changes',
    async (status) => {
      const eventId = await createEvent(status);
      await expect(
        updateEventInformation(eventId, coordinatorId, { ...TC_110_01_DATA, description: 'Edited after the event ended' }),
      ).rejects.toBeInstanceOf(ConflictError);
      expect((await eventRow(eventId)).description).toBe('Gala dinner');
    },
  );
});
