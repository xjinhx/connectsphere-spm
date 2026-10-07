import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createVenue } from '@/domain/venues/service';
import { decideVenueBookingRequest, listVenueBookings } from '@/domain/venue-booking/service';
import { formatSingaporeDate, todayInSingapore } from '@/domain/shared/dates';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-148 Approve a booking request (Jira, authoritative):
 * AC1 approved + decider and time recorded; AC2 a confirmed booking in every
 * approved slot, coordinator notified; AC3/AC4 full details on the calendar for
 * Venue Staff, the assigned coordinator and Ops Managers, "committed" for
 * everyone else; AC5 lines decided one by one, Partially Approved, reasons.
 *
 * Requests are made with SCRUM-142's create_venue_booking_request, as the
 * coordinator's form does. The notification is stand-in D-13: the recorded
 * decision, returned with the coordinator it is for.
 *
 * Runs against the local Supabase stack: decide_venue_booking_request writes
 * the decisions and bookings in one transaction, and venue_booking_one_per_slot
 * is what refuses a double booking.
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let locationId: string;
let venueStaffId: string;
let coordinatorId: string;
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
    email: `${label}+decision${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  return data.user.id;
}

async function createTestVenue(label: string) {
  const venue = await createVenue({ name: `${label} ${RUN}`, locationId, maxCapacity: 200 });
  venueIds.push(venue.id);
  return venue;
}

/** A submitted event assigned to the test coordinator. */
async function createEvent(date: string): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({ organiser_id: organiserId, client_organisation_id: CLIENT_ORGANISATION_ID, name: `Decision Event ${RUN}`, proposed_date: date })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test event: ${error?.message}`);
  eventIds.push(data.id);
  await admin.from('event_request').update({ status: 'submitted' }).eq('id', data.id);
  await admin.from('event_request').update({ coordinator_id: coordinatorId, assigned_by: coordinatorId }).eq('id', data.id);
  return data.id;
}

/** A pending booking request, made the way SCRUM-142's form makes one. Line ids come back in the order given. */
async function createRequest(venueId: string, lines: { date: string; slots: string[] }[]) {
  const eventId = await createEvent(lines[0]!.date);
  const { data: requestId, error } = await admin.rpc('create_venue_booking_request', {
    p_event_request_id: eventId,
    p_venue_id: venueId,
    p_requested_by: coordinatorId,
    p_lines: lines.map((line) => ({ date: line.date, time_slots: line.slots })),
  });
  if (error || !requestId) throw new Error(`could not create test request: ${error?.message}`);
  const { data: rows } = await admin.from('venue_booking_request_line').select('id, date, time_slots').eq('request_id', requestId);
  const lineIds = lines.map(
    (line) => rows!.find((row) => row.date === line.date && row.time_slots.join() === line.slots.join())!.id,
  );
  return { requestId: requestId as string, eventId, lineIds };
}

async function bookingsOf(eventId: string) {
  const { data } = await admin.from('venue_booking').select('date, slot, status, request_line_id').eq('event_request_id', eventId);
  return (data ?? []).map((row) => `${row.date} ${row.slot} ${row.status}`).sort();
}

async function lineStatuses(requestId: string) {
  const { data } = await admin.from('venue_booking_request_line').select('status').eq('request_id', requestId);
  return (data ?? []).map((row) => row.status).sort();
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  const { data: location, error } = await admin.from('locations').insert({ name: `Decision Location ${RUN}` }).select('id').single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;
  venueStaffId = await createUser('venue-staff');
  await admin.from('profiles').update({ full_name: 'Decision Venue Staff' }).eq('id', venueStaffId);
  coordinatorId = await createUser('coordinator');
  organiserId = await createUser('organiser');
});

afterAll(async () => {
  // Events first: their requests, lines and bookings go with them (cascade).
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of venueIds) await admin.from('venues').delete().eq('id', id);
  for (const id of [venueStaffId, coordinatorId, organiserId]) if (id) await admin.auth.admin.deleteUser(id);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
});

describe('decideVenueBookingRequest (SCRUM-148 AC1, AC2, AC5)', () => {
  it('AC1: approving a pending request makes it Approved and records who decided and when', async () => {
    const venue = await createTestVenue('Hall A');
    const { requestId, lineIds } = await createRequest(venue.id, [{ date: daysFromToday(10), slots: ['am'] }]);

    const decided = await decideVenueBookingRequest(requestId, venueStaffId, { decisions: [{ lineId: lineIds[0], decision: 'approve' }] });

    expect(decided.status).toBe('approved');
    expect(decided.lines[0]).toMatchObject({
      status: 'approved',
      decidedBy: venueStaffId,
      decidedByName: 'Decision Venue Staff',
      rejectionReason: null,
    });
    expect(decided.lines[0]!.decidedAt).not.toBeNull();
    // D-13: the decision comes back with the coordinator it is for.
    expect(decided.coordinatorId).toBe(coordinatorId);
  });

  it('AC2: creates a confirmed booking for the venue in every approved slot', async () => {
    const venue = await createTestVenue('Hall B');
    const date = daysFromToday(10);
    const { requestId, eventId, lineIds } = await createRequest(venue.id, [{ date, slots: ['am', 'pm'] }]);

    await decideVenueBookingRequest(requestId, venueStaffId, { decisions: [{ lineId: lineIds[0], decision: 'approve' }] });

    expect(await bookingsOf(eventId)).toEqual([`${date} am confirmed`, `${date} pm confirmed`]);
  });

  it("AC2: notifies the event's assigned coordinator of the decision", async () => {
    const venue = await createTestVenue('Hall N');
    const date = daysFromToday(11);
    const { requestId, eventId, lineIds } = await createRequest(venue.id, [{ date, slots: ['am'] }]);

    await decideVenueBookingRequest(requestId, venueStaffId, { decisions: [{ lineId: lineIds[0], decision: 'approve' }] });

    const { data } = await admin
      .from('notifications')
      .select('type, message')
      .eq('recipient_id', coordinatorId)
      .eq('event_request_id', eventId);
    expect(data).toEqual([{ type: 'venue_booking_update', message: `Your booking request for ${venue.name} was approved: ${formatSingaporeDate(date)} AM.` }]);
  });

  it('AC5: approves some lines and rejects one with a reason: Partially Approved, bookings for approved lines only', async () => {
    const venue = await createTestVenue('Hall C');
    const date = daysFromToday(11);
    const { requestId, eventId, lineIds } = await createRequest(venue.id, [
      { date, slots: ['am'] },
      { date, slots: ['pm'] },
      { date, slots: ['night'] },
    ]);

    const decided = await decideVenueBookingRequest(requestId, venueStaffId, {
      decisions: [
        { lineId: lineIds[0], decision: 'approve' },
        { lineId: lineIds[1], decision: 'approve' },
        { lineId: lineIds[2], decision: 'reject', reason: 'No security staff after 10pm' },
      ],
    });

    expect(decided.status).toBe('partially_approved');
    expect(decided.lines.find((line) => line.id === lineIds[2])).toMatchObject({
      status: 'rejected',
      rejectionReason: 'No security staff after 10pm',
    });
    expect(await bookingsOf(eventId)).toEqual([`${date} am confirmed`, `${date} pm confirmed`]);
  });

  it('AC5: refuses a rejected line without a reason, and changes nothing', async () => {
    const venue = await createTestVenue('Hall D');
    const date = daysFromToday(11);
    const { requestId, eventId, lineIds } = await createRequest(venue.id, [{ date, slots: ['am'] }, { date, slots: ['night'] }]);

    await expect(
      decideVenueBookingRequest(requestId, venueStaffId, {
        decisions: [
          { lineId: lineIds[0], decision: 'approve' },
          { lineId: lineIds[1], decision: 'reject', reason: '' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'A reason is required for each rejected line.' });

    expect(await lineStatuses(requestId)).toEqual(['pending', 'pending']);
    expect(await bookingsOf(eventId)).toEqual([]);
  });

  it('approving every line gives Approved, not Partially Approved', async () => {
    const venue = await createTestVenue('Hall E');
    const date = daysFromToday(12);
    const { requestId, eventId, lineIds } = await createRequest(venue.id, [
      { date, slots: ['am'] },
      { date, slots: ['pm'] },
      { date, slots: ['night'] },
    ]);

    const decided = await decideVenueBookingRequest(requestId, venueStaffId, {
      decisions: lineIds.map((lineId) => ({ lineId, decision: 'approve' as const })),
    });

    expect(decided.status).toBe('approved');
    expect(await bookingsOf(eventId)).toHaveLength(3);
  });

  it('rejecting every line gives Rejected and creates no booking', async () => {
    const venue = await createTestVenue('Hall F');
    const date = daysFromToday(12);
    const { requestId, eventId, lineIds } = await createRequest(venue.id, [{ date, slots: ['am'] }, { date, slots: ['pm'] }]);

    const decided = await decideVenueBookingRequest(requestId, venueStaffId, {
      decisions: lineIds.map((lineId) => ({ lineId, decision: 'reject' as const, reason: 'Venue under maintenance' })),
    });

    expect(decided.status).toBe('rejected');
    expect(decided.lines.every((line) => line.rejectionReason === 'Venue under maintenance')).toBe(true);
    expect(await bookingsOf(eventId)).toEqual([]);
  });

  it('refuses a decision that leaves a pending line out', async () => {
    const venue = await createTestVenue('Hall G');
    const date = daysFromToday(13);
    const { requestId, lineIds } = await createRequest(venue.id, [{ date, slots: ['am'] }, { date, slots: ['pm'] }]);

    await expect(
      decideVenueBookingRequest(requestId, venueStaffId, { decisions: [{ lineId: lineIds[0], decision: 'approve' }] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await lineStatuses(requestId)).toEqual(['pending', 'pending']);
  });

  it('refuses to decide a request twice', async () => {
    const venue = await createTestVenue('Hall H');
    const { requestId, lineIds } = await createRequest(venue.id, [{ date: daysFromToday(13), slots: ['am'] }]);
    const decision = { decisions: [{ lineId: lineIds[0], decision: 'approve' }] };
    await decideVenueBookingRequest(requestId, venueStaffId, decision);

    await expect(decideVenueBookingRequest(requestId, venueStaffId, decision)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'already_decided' },
    });
  });

  it('AC1 "with no conflict": refuses a slot that already holds a confirmed booking, and saves nothing', async () => {
    const venue = await createTestVenue('Hall I');
    const date = daysFromToday(14);
    const first = await createRequest(venue.id, [{ date, slots: ['pm'] }]);
    await decideVenueBookingRequest(first.requestId, venueStaffId, { decisions: [{ lineId: first.lineIds[0], decision: 'approve' }] });
    const second = await createRequest(venue.id, [{ date, slots: ['am', 'pm'] }]);

    await expect(
      decideVenueBookingRequest(second.requestId, venueStaffId, { decisions: [{ lineId: second.lineIds[0], decision: 'approve' }] }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'slot_already_booked' } });

    expect(await lineStatuses(second.requestId)).toEqual(['pending']);
    expect(await bookingsOf(second.eventId)).toEqual([]);
  });

  it('reports an unknown request as not found', async () => {
    await expect(
      decideVenueBookingRequest('99999999-9999-4999-8999-999999999999', venueStaffId, {
        decisions: [{ lineId: '99999999-9999-4999-8999-999999999998', decision: 'approve' }],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('listVenueBookings (SCRUM-148 AC3, AC4)', () => {
  let venueId: string;
  let date: string;

  beforeAll(async () => {
    const venue = await createTestVenue('Hall J');
    venueId = venue.id;
    date = daysFromToday(15);
    const { requestId, lineIds } = await createRequest(venueId, [{ date, slots: ['am'] }]);
    await decideVenueBookingRequest(requestId, venueStaffId, { decisions: [{ lineId: lineIds[0], decision: 'approve' }] });
  });

  const STRANGER = '55555555-5555-4555-8555-555555555555';

  it.each([
    ['Venue Staff', () => ({ userId: STRANGER, roles: ['venue_staff' as const] })],
    ['an Event Operations Manager', () => ({ userId: STRANGER, roles: ['operations_manager' as const] })],
    ["the event's assigned coordinator", () => ({ userId: coordinatorId, roles: ['coordinator' as const] })],
  ])('AC3: %s sees the booked slot as confirmed, with its event reference', async (_who, actor) => {
    const [booking] = await listVenueBookings(venueId, { from: date, to: date }, actor());
    expect(booking).toMatchObject({ date, slot: 'am', state: 'confirmed', event: { reference: expect.stringMatching(/^EVT-/) } });
  });

  it.each([
    ['a coordinator not assigned to the event', ['coordinator' as const]],
    ['Technical Support Staff', ['technical_support' as const]],
  ])('AC4: %s sees the slot as committed, with no event details', async (_who, roles) => {
    const bookings = await listVenueBookings(venueId, { from: date, to: date }, { userId: STRANGER, roles });
    expect(bookings).toEqual([{ date, slot: 'am', state: 'committed' }]);
  });

  it('leaves out bookings outside the dates asked for', async () => {
    const next = daysFromToday(16);
    expect(await listVenueBookings(venueId, { from: next, to: next }, { userId: STRANGER, roles: ['venue_staff'] })).toEqual([]);
  });

  it('refuses a range that ends before it starts', async () => {
    await expect(
      listVenueBookings(venueId, { from: daysFromToday(16), to: daysFromToday(15) }, { userId: STRANGER, roles: ['venue_staff'] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
