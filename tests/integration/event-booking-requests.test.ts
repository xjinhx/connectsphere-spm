import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createVenue } from '@/domain/venues/service';
import { decideVenueBookingRequest, listEventBookingRequests } from '@/domain/venue-booking/service';
import { todayInSingapore } from '@/domain/shared/dates';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-236 See my event's booking requests from the event page (Jira,
 * authoritative): AC1 each request listed with its venue, requested dates with
 * start and end times, and status; AC3 an event with no requests lists none.
 * AC2 (opening the request page) is SCRUM-149's page, linked by request id.
 *
 * Requests are made with SCRUM-142's create_venue_booking_request and decided
 * with SCRUM-148's decision, as the app does. Runs against the local stack.
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let locationId: string;
let venueStaffId: string;
let coordinatorId: string;
let otherCoordinatorId: string;
let organiserId: string;
const venueIds: string[] = [];
const eventIds: string[] = [];

function daysFromToday(days: number): string {
  const date = new Date(`${todayInSingapore()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+requests${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  return data.user.id;
}

async function createTestVenue(label: string): Promise<{ id: string; name: string }> {
  const venue = await createVenue({ name: `${label} ${RUN}`, locationId, maxCapacity: 200 });
  venueIds.push(venue.id);
  return { id: venue.id, name: venue.name };
}

/** A submitted event assigned to `coordinator`. */
async function createEvent(coordinator = coordinatorId): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({ organiser_id: organiserId, client_organisation_id: CLIENT_ORGANISATION_ID, name: `Requests Event ${RUN}` })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test event: ${error?.message}`);
  eventIds.push(data.id);
  for (const patch of [{ status: 'submitted' }, { coordinator_id: coordinator, assigned_by: coordinator }]) {
    const { error: stepError } = await admin.from('event_request').update(patch).eq('id', data.id);
    if (stepError) throw new Error(`could not prepare test event: ${stepError.message}`);
  }
  return data.id;
}

/** A pending request for the event, one line per entry; returns its id and line ids in the order given. */
async function request(eventId: string, venueId: string, lines: { date: string; slots: string[] }[], coordinator = coordinatorId) {
  const { data: requestId, error } = await admin.rpc('create_venue_booking_request', {
    p_event_request_id: eventId,
    p_venue_id: venueId,
    p_requested_by: coordinator,
    p_lines: lines.map((line) => ({ date: line.date, time_slots: line.slots })),
  });
  if (error || !requestId) throw new Error(`could not create test request: ${error?.message}`);
  const { data: rows } = await admin.from('venue_booking_request_line').select('id, date').eq('request_id', requestId);
  return { requestId: requestId as string, lineIds: lines.map((line) => rows!.find((row) => row.date === line.date)!.id) };
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  const { data: location, error } = await admin.from('locations').insert({ name: `Requests Location ${RUN}` }).select('id').single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;
  venueStaffId = await createUser('venue-staff');
  coordinatorId = await createUser('coordinator');
  otherCoordinatorId = await createUser('other-coordinator');
  organiserId = await createUser('organiser');
});

afterAll(async () => {
  // Events first: their requests and lines go with them (cascade).
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of venueIds) await admin.from('venues').delete().eq('id', id);
  for (const id of [venueStaffId, coordinatorId, otherCoordinatorId, organiserId]) if (id) await admin.auth.admin.deleteUser(id);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
});

describe('listEventBookingRequests (SCRUM-236)', () => {
  it('AC1: lists a pending request with its venue, date, start and end time, and status (TC-236-01)', async () => {
    const eventId = await createEvent();
    const bugis = await createTestVenue('Bugis');
    const date = daysFromToday(30);
    const { requestId } = await request(eventId, bugis.id, [{ date, slots: ['am'] }]);

    expect(await listEventBookingRequests(eventId)).toEqual([
      { id: requestId, venueName: bugis.name, status: 'pending', lines: [{ date, startTime: '07:00', endTime: '12:00' }] },
    ]);
  });

  it('AC1: lists every request, newest first, one in each status (TC-236-02)', async () => {
    const eventId = await createEvent();
    const [bugis, marina, jurong] = [await createTestVenue('Bugis B'), await createTestVenue('Marina'), await createTestVenue('Jurong')];
    const [d3, d4, d5, d6, d7] = [31, 32, 33, 34, 35].map(daysFromToday);

    const pending = await request(eventId, bugis.id, [{ date: d3!, slots: ['am'] }]);
    const approved = await request(eventId, marina.id, [{ date: d4!, slots: ['pm'] }]);
    await decideVenueBookingRequest(approved.requestId, venueStaffId, { decisions: [{ lineId: approved.lineIds[0], decision: 'approve' }] });
    const partial = await request(eventId, jurong.id, [{ date: d5!, slots: ['am'] }, { date: d6!, slots: ['am'] }]);
    await decideVenueBookingRequest(partial.requestId, venueStaffId, {
      decisions: [
        { lineId: partial.lineIds[0], decision: 'approve' },
        { lineId: partial.lineIds[1], decision: 'reject', reason: 'Room closed for renovation' },
      ],
    });
    const rejected = await request(eventId, bugis.id, [{ date: d7!, slots: ['pm'] }]);
    await decideVenueBookingRequest(rejected.requestId, venueStaffId, {
      decisions: [{ lineId: rejected.lineIds[0], decision: 'reject', reason: 'Closed for a private function' }],
    });

    const listed = await listEventBookingRequests(eventId);

    expect(listed.map((r) => [r.id, r.venueName, r.status])).toEqual([
      [rejected.requestId, bugis.name, 'rejected'],
      [partial.requestId, jurong.name, 'partially_approved'],
      [approved.requestId, marina.name, 'approved'],
      [pending.requestId, bugis.name, 'pending'],
    ]);
    // Several dates on one request come in date order, each with its times.
    expect(listed[1]!.lines).toEqual([
      { date: d5, startTime: '07:00', endTime: '12:00' },
      { date: d6, startTime: '07:00', endTime: '12:00' },
    ]);
    expect(listed[0]!.lines).toEqual([{ date: d7, startTime: '13:00', endTime: '18:00' }]);
  });

  it("AC1: does not list another event's requests (TC-236-03)", async () => {
    const eventId = await createEvent();
    const otherEventId = await createEvent(otherCoordinatorId);
    const bugis = await createTestVenue('Bugis C');
    const mine = await request(eventId, bugis.id, [{ date: daysFromToday(36), slots: ['am'] }]);
    await request(otherEventId, bugis.id, [{ date: daysFromToday(37), slots: ['am'] }], otherCoordinatorId);

    expect((await listEventBookingRequests(eventId)).map((r) => r.id)).toEqual([mine.requestId]);
  });

  it('AC3: an event with no booking requests lists none (TC-236-06)', async () => {
    expect(await listEventBookingRequests(await createEvent())).toEqual([]);
  });
});
