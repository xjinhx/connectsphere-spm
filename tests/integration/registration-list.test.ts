import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { getRegistrationSettings, updateRegistrationSettings } from '@/domain/registration-list/service';
import {
  NO_CONFIRMED_VENUE_MESSAGE,
  capacityOverVenueMessage,
  notConfirmedNotice,
} from '@/domain/registration-list/policy';
import { END_BEFORE_START_MESSAGE } from '@/domain/registration-list/schema';
import { getRegistrationPage } from '@/domain/event-registration/service';
import { decideVenueBookingRequest } from '@/domain/venue-booking/service';
import { createVenue } from '@/domain/venues/service';
import { ConflictError, ForbiddenError, ValidationError } from '@/domain/shared/errors';
import { todayInSingapore } from '@/domain/shared/dates';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-185 View the registration list for an event (Jira, authoritative):
 *   AC5 the assigned coordinator of a Confirmed event sets the registration
 *       start date, end date and capacity; they are saved and shown on the
 *       registration page;
 *   AC6 an end date before the start date, or a capacity above the largest of
 *       the event's venue capacities (CL-59), is refused naming the field.
 * PO clarifications, 28 Oct 2026: read-only from Preparation on, and no
 * confirmed venue booking refuses the capacity (CL-65); an end date after the
 * event date is accepted (CL-66).
 *
 * Runs against the local Supabase stack. Test case IDs are from the Sprint 4
 * sheet's SCRUM-185 tab (TC-185-nn). Venues are booked the real way (SCRUM-142
 * request, SCRUM-148 approval), so the limit comes from confirmed bookings.
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let locationId: string;
let venueStaffId: string;
let coordinatorId: string;
let otherCoordinatorId: string;
let organiserId: string;
let attendeeId: string;
const venueIds: string[] = [];
const eventIds: string[] = [];

function daysFromToday(days: number): string {
  const date = new Date(`${todayInSingapore()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+reg${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  return data.user.id;
}

/** An event submitted by the organiser, assigned to the coordinator, Approved then in Planning. */
async function createPlanningEvent(name: string, date: string): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: CLIENT_ORGANISATION_ID,
      name: `${name} ${RUN}`,
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
  const steps: Record<string, unknown>[] = [
    { status: 'submitted' },
    { coordinator_id: coordinatorId, assigned_by: coordinatorId },
    { status: 'approved', decision: 'approved', decided_by: coordinatorId },
    { status: 'planning' },
  ];
  for (const patch of steps) {
    const { error: stepError } = await admin.from('event_request').update(patch).eq('id', data.id);
    if (stepError) throw new Error(`could not prepare test event: ${stepError.message}`);
  }
  return data.id;
}

async function confirm(eventId: string): Promise<void> {
  const { error } = await admin.from('event_request').update({ status: 'confirmed' }).eq('id', eventId);
  if (error) throw new Error(`could not confirm test event: ${error.message}`);
}

/** A confirmed venue booking at a venue of `maxCapacity`, made the real way. */
async function book(eventId: string, date: string, maxCapacity: number): Promise<void> {
  // Venue names are unique, so each booking gets its own venue.
  const venue = await createVenue({ name: `S185 Venue ${venueIds.length + 1} ${RUN}`, locationId, maxCapacity });
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
}

/** A Confirmed event with a confirmed booking at each of `capacities`. */
async function confirmedEvent(name: string, capacities: number[]): Promise<string> {
  const date = daysFromToday(30);
  const eventId = await createPlanningEvent(name, date);
  for (const capacity of capacities) await book(eventId, date, capacity);
  await confirm(eventId);
  return eventId;
}

async function stored(eventId: string) {
  const { data } = await admin
    .from('event_request')
    .select('registration_start_date, registration_end_date, registration_capacity')
    .eq('id', eventId)
    .single();
  return data;
}

async function expectRefused(promise: Promise<unknown>, type: new (...args: never[]) => Error, field?: string, message?: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(type);
  if (message) expect((error as Error).message).toBe(message);
  if (field) {
    const details = (error as ValidationError).details as { fieldErrors: Record<string, string[]> };
    expect(Object.keys(details.fieldErrors)).toEqual([field]);
  }
}

const START = daysFromToday(5);
const END = daysFromToday(20);

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  const { data: location, error } = await admin.from('locations').insert({ name: `S185 Location ${RUN}` }).select('id').single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;
  venueStaffId = await createUser('venue-staff');
  coordinatorId = await createUser('coordinator');
  otherCoordinatorId = await createUser('coordinator-b');
  organiserId = await createUser('organiser');
  attendeeId = await createUser('attendee');
});

afterAll(async () => {
  // Events first: their requests, lines and bookings go with them (cascade).
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of venueIds) await admin.from('venues').delete().eq('id', id);
  for (const id of [venueStaffId, coordinatorId, otherCoordinatorId, organiserId, attendeeId]) {
    if (id) await admin.auth.admin.deleteUser(id);
  }
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
});

describe('SCRUM-185 AC5: the assigned coordinator sets registration on a Confirmed event', () => {
  it('SCRUM-185 AC5 TC-185-01 saves the three and the registration page shows them', async () => {
    const eventId = await confirmedEvent('S185 Harbour Gala', [300]);

    const saved = await updateRegistrationSettings(eventId, coordinatorId, {
      startDate: START,
      endDate: END,
      capacity: '250',
    });

    expect(saved).toEqual({ startDate: START, endDate: END, capacity: 250 });
    expect(await stored(eventId)).toEqual({
      registration_start_date: START,
      registration_end_date: END,
      registration_capacity: 250,
    });

    // The coordinator's registration page, read back after a reload.
    const view = await getRegistrationSettings(eventId, { userId: coordinatorId, roles: ['coordinator'] });
    expect(view).toMatchObject({
      startDate: START,
      endDate: END,
      capacity: 250,
      largestVenueCapacity: 300,
      canEdit: true,
      readOnlyReason: null,
    });

    // Replaces D-22: SCRUM-181's attendee page reads the same period.
    const page = await getRegistrationPage(eventId, attendeeId);
    expect(page.period).toEqual({ startDate: START, endDate: END });
  });

  it('SCRUM-185 AC5 TC-185-02 a Planning event is refused and nothing is saved', async () => {
    const date = daysFromToday(30);
    const eventId = await createPlanningEvent('S185 Planning Talk', date);
    await book(eventId, date, 300);

    await expectRefused(
      updateRegistrationSettings(eventId, coordinatorId, { startDate: START, endDate: END, capacity: 50 }),
      ConflictError,
      undefined,
      notConfirmedNotice('planning'),
    );
    expect(await stored(eventId)).toEqual({
      registration_start_date: null,
      registration_end_date: null,
      registration_capacity: null,
    });

    const view = await getRegistrationSettings(eventId, { userId: coordinatorId, roles: ['coordinator'] });
    expect(view.canEdit).toBe(false);
    expect(view.readOnlyReason).toBe(notConfirmedNotice('planning'));
  });

  it('SCRUM-185 AC5 TC-185-15 from Preparation the values are read-only: shown, and a save is refused (CL-65)', async () => {
    const eventId = await confirmedEvent('S185 Prep Night', [300]);
    await updateRegistrationSettings(eventId, coordinatorId, { startDate: START, endDate: END, capacity: 250 });
    const { error } = await admin.from('event_request').update({ status: 'preparation' }).eq('id', eventId);
    if (error) throw new Error(`could not move test event to Preparation: ${error.message}`);

    await expectRefused(
      updateRegistrationSettings(eventId, coordinatorId, { startDate: START, endDate: END, capacity: 100 }),
      ConflictError,
      undefined,
      notConfirmedNotice('preparation'),
    );
    expect(await stored(eventId)).toEqual({
      registration_start_date: START,
      registration_end_date: END,
      registration_capacity: 250,
    });

    const view = await getRegistrationSettings(eventId, { userId: coordinatorId, roles: ['coordinator'] });
    expect(view).toMatchObject({
      startDate: START,
      endDate: END,
      capacity: 250,
      canEdit: false,
      readOnlyReason: notConfirmedNotice('preparation'),
    });
  });

  it('SCRUM-185 AC5 TC-185-03 a coordinator not assigned to the event is refused', async () => {
    const eventId = await confirmedEvent('S185 Harbour Gala B', [300]);
    await updateRegistrationSettings(eventId, coordinatorId, { startDate: START, endDate: END, capacity: 250 });

    await expectRefused(
      updateRegistrationSettings(eventId, otherCoordinatorId, { startDate: START, endDate: END, capacity: 100 }),
      ForbiddenError,
    );
    await expectRefused(
      getRegistrationSettings(eventId, { userId: otherCoordinatorId, roles: ['coordinator'] }),
      ForbiddenError,
    );
    expect((await stored(eventId))?.registration_capacity).toBe(250);
  });
});

describe('SCRUM-185 AC6: refused with a message naming the field', () => {
  it('SCRUM-185 AC6 TC-185-04 an end date before the start date is refused on the end date', async () => {
    const eventId = await confirmedEvent('S185 Harbour Gala C', [300]);

    await expectRefused(
      updateRegistrationSettings(eventId, coordinatorId, { startDate: END, endDate: START, capacity: 50 }),
      ValidationError,
      'endDate',
      END_BEFORE_START_MESSAGE,
    );
    expect((await stored(eventId))?.registration_start_date).toBeNull();
  });

  it('SCRUM-185 AC6 TC-185-05 capacity at the venue capacity is saved; one more is refused', async () => {
    const eventId = await confirmedEvent('S185 Harbour Gala D', [300]);

    await updateRegistrationSettings(eventId, coordinatorId, { startDate: START, endDate: END, capacity: 300 });
    expect((await stored(eventId))?.registration_capacity).toBe(300);

    await expectRefused(
      updateRegistrationSettings(eventId, coordinatorId, { startDate: START, endDate: END, capacity: 301 }),
      ValidationError,
      'capacity',
      capacityOverVenueMessage(300),
    );
    expect((await stored(eventId))?.registration_capacity).toBe(300);
  });

  it('SCRUM-185 AC6 TC-185-06 with several venues the limit is the largest of their capacities', async () => {
    const eventId = await confirmedEvent('S185 Two Hall Expo', [300, 200]);

    await updateRegistrationSettings(eventId, coordinatorId, { startDate: START, endDate: END, capacity: 300 });
    expect((await stored(eventId))?.registration_capacity).toBe(300);

    await expectRefused(
      updateRegistrationSettings(eventId, coordinatorId, { startDate: START, endDate: END, capacity: 301 }),
      ValidationError,
      'capacity',
      capacityOverVenueMessage(300),
    );
  });

  it('SCRUM-185 AC6 TC-185-16 a Confirmed event with no confirmed venue booking is refused on capacity (CL-65)', async () => {
    const eventId = await createPlanningEvent('S185 No Venue', daysFromToday(30));
    await confirm(eventId);

    await expectRefused(
      updateRegistrationSettings(eventId, coordinatorId, { startDate: START, endDate: END, capacity: 10 }),
      ValidationError,
      'capacity',
      NO_CONFIRMED_VENUE_MESSAGE,
    );
    expect(await stored(eventId)).toEqual({
      registration_start_date: null,
      registration_end_date: null,
      registration_capacity: null,
    });
  });

  it('SCRUM-185 AC6 TC-185-17 an end date after the event date is saved (CL-66)', async () => {
    const eventId = await confirmedEvent('S185 Late Close', [300]); // the event is 30 days out
    const afterEvent = daysFromToday(45);

    await updateRegistrationSettings(eventId, coordinatorId, { startDate: START, endDate: afterEvent, capacity: 100 });

    expect(await stored(eventId)).toEqual({
      registration_start_date: START,
      registration_end_date: afterEvent,
      registration_capacity: 100,
    });
  });
});
