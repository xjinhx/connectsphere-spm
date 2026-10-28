import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  exportRegistrationList,
  getRegistrationList,
  updateRegistrationSettings,
} from '@/domain/registration-list/service';
import { EXPORT_HEADERS, EXPORT_NOT_ALLOWED_MESSAGE, NO_ACCESS_MESSAGE } from '@/domain/registration-list/policy';
import { registerForEvent } from '@/domain/event-registration/service';
import { decideVenueBookingRequest } from '@/domain/venue-booking/service';
import { createVenue } from '@/domain/venues/service';
import { ForbiddenError } from '@/domain/shared/errors';
import { formatDayMonthYear, todayInSingapore } from '@/domain/shared/dates';
import type { Role } from '@/domain/identity/roles';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-185 View the registration list for an event (Jira, authoritative):
 *   AC1 the assigned coordinator sees the registered attendees with their
 *       registration date and status, the number registered, the capacity and
 *       the places remaining;
 *   AC2 the Event Organiser responsible for the event views and exports it;
 *   AC3 an organiser in the same client organisation views it, no export;
 *   AC4 an organiser of an unrelated organisation is denied.
 * Also AC6's one-day period boundary (TC-185-15).
 *
 * Runs against the local Supabase stack. Test case IDs are from the Sprint 4
 * sheet's SCRUM-185 tab (TC-185-nn). Attendees register through SCRUM-181's
 * own service, inside a period and capacity set through AC5's.
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_ORGANISATION_ID = '55555555-5555-4555-8555-555555555555';

let locationId: string;
let venueStaffId: string;
let coordinatorId: string;
let otherCoordinatorId: string;
let organiserId: string;
let colleagueId: string;
let otherOrganiserId: string;
const attendeeIds: string[] = [];
const venueIds: string[] = [];
const eventIds: string[] = [];

const TODAY = todayInSingapore();

function daysFromToday(days: number): string {
  const date = new Date(`${TODAY}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+list${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  return data.user.id;
}

const as = (userId: string, roles: Role[], clientOrganisationId: string | null = null) => ({
  userId,
  roles,
  clientOrganisation: clientOrganisationId ? { id: clientOrganisationId } : null,
});
const coordinator = () => as(coordinatorId, ['coordinator']);
const organiser = () => as(organiserId, ['event_organiser'], CLIENT_ORGANISATION_ID);
const colleague = () => as(colleagueId, ['event_organiser'], CLIENT_ORGANISATION_ID);
const otherOrganiser = () => as(otherOrganiserId, ['event_organiser'], OTHER_ORGANISATION_ID);

/**
 * A Confirmed event of the organiser's, assigned to the coordinator, booked at
 * a 300-capacity venue, with registration open today (AC5's form) and
 * `capacity` places.
 */
async function openEvent(name: string, capacity: number): Promise<string> {
  const date = daysFromToday(30);
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
      registration_required: true,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test event: ${error?.message}`);
  eventIds.push(data.id);
  for (const patch of [
    { status: 'submitted' },
    { coordinator_id: coordinatorId, assigned_by: coordinatorId },
    { status: 'approved', decision: 'approved', decided_by: coordinatorId },
    { status: 'planning' },
  ]) {
    const { error: stepError } = await admin.from('event_request').update(patch).eq('id', data.id);
    if (stepError) throw new Error(`could not prepare test event: ${stepError.message}`);
  }

  const venue = await createVenue({ name: `S185L Venue ${venueIds.length + 1} ${RUN}`, locationId, maxCapacity: 300 });
  venueIds.push(venue.id);
  const { data: requestId, error: requestError } = await admin.rpc('create_venue_booking_request', {
    p_event_request_id: data.id,
    p_venue_id: venue.id,
    p_requested_by: coordinatorId,
    p_lines: [{ date, start: '10:00', end: '12:00' }],
  });
  if (requestError || !requestId) throw new Error(`could not create test request: ${requestError?.message}`);
  const { data: line } = await admin.from('venue_booking_request_line').select('id').eq('request_id', requestId).single();
  await decideVenueBookingRequest(requestId as string, venueStaffId, { decisions: [{ lineId: line!.id, decision: 'approve' }] });

  await admin.from('event_request').update({ status: 'confirmed' }).eq('id', data.id);
  await updateRegistrationSettings(data.id, coordinatorId, {
    startDate: TODAY,
    endDate: daysFromToday(10),
    capacity,
  });
  return data.id;
}

/** Registers attendee n (1-based) through SCRUM-181's service. */
async function register(eventId: string, n: number) {
  return registerForEvent(eventId, attendeeIds[n - 1]!, {
    fullName: `Attendee ${n}`,
    email: `attendee${n}@example.com`,
    contactNumber: `+65 9000 000${n}`,
  });
}

async function expectForbidden(promise: Promise<unknown>, message: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ForbiddenError);
  expect((error as Error).message).toBe(message);
}

let galaId: string;

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  await admin.from('client_organisations').upsert({ id: OTHER_ORGANISATION_ID, name: `Lion City Conferences ${RUN}` });
  const { data: location, error } = await admin.from('locations').insert({ name: `S185L Location ${RUN}` }).select('id').single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;
  venueStaffId = await createUser('venue-staff');
  coordinatorId = await createUser('coordinator');
  otherCoordinatorId = await createUser('coordinator-b');
  organiserId = await createUser('organiser');
  colleagueId = await createUser('organiser-colleague');
  otherOrganiserId = await createUser('organiser-other');
  for (let n = 1; n <= 3; n += 1) attendeeIds.push(await createUser(`attendee${n}`));

  // TC-185-01's event: capacity 250, three registered.
  galaId = await openEvent('S185 Harbour Gala', 250);
  for (let n = 1; n <= 3; n += 1) await register(galaId, n);
});

afterAll(async () => {
  // Events first: their registrations, requests and bookings go with them (cascade).
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of venueIds) await admin.from('venues').delete().eq('id', id);
  for (const id of [venueStaffId, coordinatorId, otherCoordinatorId, organiserId, colleagueId, otherOrganiserId, ...attendeeIds]) {
    if (id) await admin.auth.admin.deleteUser(id);
  }
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
  await admin.from('client_organisations').delete().eq('id', OTHER_ORGANISATION_ID);
});

describe('SCRUM-185 AC1: the assigned coordinator sees the list and the counts', () => {
  it('SCRUM-185 AC1 TC-185-01 three registered: each with date and status; 3, 250, 247', async () => {
    const view = await getRegistrationList(galaId, coordinator());

    expect(view.viewer).toBe('coordinator');
    expect(view.registrations.map((entry) => entry.fullName)).toEqual(['Attendee 1', 'Attendee 2', 'Attendee 3']);
    for (const entry of view.registrations) {
      expect(entry.status).toBe('registered');
      expect(entry.registeredAt).toBeTruthy();
    }
    expect({ registered: view.registered, capacity: view.capacity, placesRemaining: view.placesRemaining }).toEqual({
      registered: 3,
      capacity: 250,
      placesRemaining: 247,
    });
    // AC1 names no export for the coordinator; AC2 gives it to the organiser.
    expect(view.canExport).toBe(false);
  });

  it('SCRUM-185 AC1 TC-185-02 no registrations: an empty list, not an error; 0, 250, 250', async () => {
    const eventId = await openEvent('S185 Quiet Talk', 250);

    const view = await getRegistrationList(eventId, coordinator());

    expect(view.registrations).toEqual([]);
    expect([view.registered, view.capacity, view.placesRemaining]).toEqual([0, 250, 250]);
  });

  it('SCRUM-185 AC1 TC-185-03 a full event: 2 registered of 2, no places remaining', async () => {
    const eventId = await openEvent('S185 Small Workshop', 2);
    await register(eventId, 1);
    await register(eventId, 2);

    const view = await getRegistrationList(eventId, coordinator());

    expect([view.registered, view.capacity, view.placesRemaining]).toEqual([2, 2, 0]);
  });

  it('a coordinator the event is not assigned to is denied', async () => {
    await expectForbidden(getRegistrationList(galaId, as(otherCoordinatorId, ['coordinator'])), NO_ACCESS_MESSAGE);
  });

  it('the Event Coordinator Lead views it read-only, with no export', async () => {
    const view = await getRegistrationList(galaId, as(otherCoordinatorId, ['operations_manager']));
    expect(view.viewer).toBe('lead');
    expect(view.registered).toBe(3);
    expect(view.canExport).toBe(false);
  });
});

describe('SCRUM-185 AC2: the responsible organiser views and exports', () => {
  it('SCRUM-185 AC2 TC-185-04 views the list with Export, and the CSV holds each attendee', async () => {
    const view = await getRegistrationList(galaId, organiser());
    expect(view.viewer).toBe('organiser');
    expect(view.registered).toBe(3);
    expect(view.canExport).toBe(true);

    const { fileName, csv } = await exportRegistrationList(galaId, organiser());

    const { data: event } = await admin.from('event_request').select('reference').eq('id', galaId).single();
    expect(fileName).toBe(`registrations-${event!.reference}.csv`);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe(EXPORT_HEADERS.join(','));
    expect(lines).toHaveLength(4);
    const date = formatDayMonthYear(TODAY);
    expect(lines[1]).toMatch(new RegExp(`^REG-\\d{4}-\\d{4},Attendee 1,attendee1@example.com,'\\+65 9000 0001,${date},Registered$`));
  });
});

describe('SCRUM-185 AC3: a same-organisation organiser views without export', () => {
  it('SCRUM-185 AC3 TC-185-05 the list is shown with no Export', async () => {
    const view = await getRegistrationList(galaId, colleague());
    expect(view.viewer).toBe('colleague');
    expect(view.registered).toBe(3);
    expect(view.canExport).toBe(false);
  });

  it('SCRUM-185 AC3 TC-185-06 exporting is refused', async () => {
    await expectForbidden(exportRegistrationList(galaId, colleague()), EXPORT_NOT_ALLOWED_MESSAGE);
  });
});

describe('SCRUM-185 AC4: an unrelated organisation is denied', () => {
  it('SCRUM-185 AC4 TC-185-07 viewing and exporting are both refused', async () => {
    await expectForbidden(getRegistrationList(galaId, otherOrganiser()), NO_ACCESS_MESSAGE);
    await expectForbidden(exportRegistrationList(galaId, otherOrganiser()), NO_ACCESS_MESSAGE);
  });
});

describe('SCRUM-185 AC6: a one-day period', () => {
  it('SCRUM-185 AC6 TC-185-15 start date = end date is saved', async () => {
    const eventId = await openEvent('S185 One Day', 250);
    const day = daysFromToday(13);

    const saved = await updateRegistrationSettings(eventId, coordinatorId, { startDate: day, endDate: day, capacity: 250 });

    expect(saved).toEqual({ startDate: day, endDate: day, capacity: 250 });
  });
});
