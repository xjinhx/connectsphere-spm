import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createVenue } from '@/domain/venues/service';
import { decideVenueBookingRequest, listVenueBookings, viewVenueBookingRequest } from '@/domain/venue-booking/service';
import { SLOT_COMMITTED_REASON } from '@/domain/venue-booking/policy';
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
 *
 * SCRUM-149 Reject a booking request with a reason uses the same decision
 * (last describe): AC1 Rejected with the reason kept, AC2 no reason refused,
 * AC3 the event's coordinator sees the reason and who decided.
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

/** A submitted event assigned to the test coordinator, or to `coordinator`. */
async function createEvent(date: string, coordinator = coordinatorId): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({ organiser_id: organiserId, client_organisation_id: CLIENT_ORGANISATION_ID, name: `Decision Event ${RUN}`, proposed_date: date })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test event: ${error?.message}`);
  eventIds.push(data.id);
  await admin.from('event_request').update({ status: 'submitted' }).eq('id', data.id);
  await admin.from('event_request').update({ coordinator_id: coordinator, assigned_by: coordinator }).eq('id', data.id);
  return data.id;
}

/** A pending booking request, made the way SCRUM-142's form makes one. Line ids come back in the order given. */
async function createRequest(venueId: string, lines: { date: string; slots: string[] }[], coordinator = coordinatorId) {
  const eventId = await createEvent(lines[0]!.date, coordinator);
  const { data: requestId, error } = await admin.rpc('create_venue_booking_request', {
    p_event_request_id: eventId,
    p_venue_id: venueId,
    p_requested_by: coordinator,
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
  otherCoordinatorId = await createUser('other-coordinator');
  organiserId = await createUser('organiser');
});

afterAll(async () => {
  // Events first: their requests, lines and bookings go with them (cascade).
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of venueIds) await admin.from('venues').delete().eq('id', id);
  for (const id of [venueStaffId, coordinatorId, otherCoordinatorId, organiserId]) if (id) await admin.auth.admin.deleteUser(id);
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

  it('AC1 "with no conflict": the database refuses a slot that already holds a confirmed booking, and saves nothing', async () => {
    const venue = await createTestVenue('Hall I');
    const date = daysFromToday(14);
    const first = await createRequest(venue.id, [{ date, slots: ['pm'] }]);
    await decideVenueBookingRequest(first.requestId, venueStaffId, { decisions: [{ lineId: first.lineIds[0], decision: 'approve' }] });
    const second = await createRequest(venue.id, [{ date, slots: ['am', 'pm'] }]);

    // Straight to the database function, past the service's check (SCRUM-155):
    // venue_booking_one_per_slot is the guarantee underneath it.
    const { error } = await admin.rpc('decide_venue_booking_request', {
      p_request_id: second.requestId,
      p_decisions: [{ line_id: second.lineIds[0], decision: 'approve', reason: null }],
      p_decided_by: venueStaffId,
    });
    expect(error?.code).toBe('23505');

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

describe('rejecting a booking request (SCRUM-149 AC1, AC2, AC3)', () => {
  it('AC1: rejecting a pending request with a reason makes it Rejected and keeps the reason (TC-149-01)', async () => {
    const venue = await createTestVenue('Hall K');
    const date = daysFromToday(16);
    const { requestId, eventId, lineIds } = await createRequest(venue.id, [{ date, slots: ['pm'] }]);

    const decided = await decideVenueBookingRequest(requestId, venueStaffId, {
      decisions: [{ lineId: lineIds[0], decision: 'reject', reason: 'Capacity is 80, event needs 150' }],
    });

    expect(decided.status).toBe('rejected');
    expect(decided.lines[0]).toMatchObject({
      status: 'rejected',
      decidedBy: venueStaffId,
      rejectionReason: 'Capacity is 80, event needs 150',
    });
    expect(await bookingsOf(eventId)).toEqual([]);
    // AC1: "the coordinator is notified", through SCRUM-193's notifications.
    const { data: sent } = await admin
      .from('notifications')
      .select('type, message')
      .eq('recipient_id', coordinatorId)
      .eq('event_request_id', eventId);
    expect(sent).toEqual([
      {
        type: 'venue_booking_update',
        message: `Your booking request for ${venue.name} was rejected: ${formatSingaporeDate(date)} PM (Capacity is 80, event needs 150).`,
      },
    ]);
  });

  it('AC2: refuses a rejection without a reason, and the request stays Pending (TC-149-03)', async () => {
    const venue = await createTestVenue('Hall L');
    const { requestId, lineIds } = await createRequest(venue.id, [{ date: daysFromToday(16), slots: ['am'] }]);

    await expect(
      decideVenueBookingRequest(requestId, venueStaffId, { decisions: [{ lineId: lineIds[0], decision: 'reject', reason: '' }] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'A reason is required for each rejected line.' });
    expect(await lineStatuses(requestId)).toEqual(['pending']);
  });

  describe('AC3: the coordinator sees the reason and who decided (TC-149-02)', () => {
    let requestId: string;

    beforeAll(async () => {
      const venue = await createTestVenue('Hall M');
      const created = await createRequest(venue.id, [{ date: daysFromToday(17), slots: ['pm'] }]);
      requestId = created.requestId;
      await decideVenueBookingRequest(requestId, venueStaffId, {
        decisions: [{ lineId: created.lineIds[0], decision: 'reject', reason: 'Capacity is 80, event needs 150' }],
      });
    });

    it("shows the event's assigned coordinator the reason and the deciding staff member", async () => {
      const seen = await viewVenueBookingRequest(requestId, { userId: coordinatorId, roles: ['coordinator'] });

      expect(seen.status).toBe('rejected');
      expect(seen.lines[0]).toMatchObject({
        rejectionReason: 'Capacity is 80, event needs 150',
        decidedByName: 'Decision Venue Staff',
      });
    });

    it('lets Venue Staff open it too', async () => {
      await expect(
        viewVenueBookingRequest(requestId, { userId: venueStaffId, roles: ['venue_staff'] }),
      ).resolves.toMatchObject({ status: 'rejected' });
    });

    it('refuses a coordinator who is not assigned to the event', async () => {
      await expect(
        viewVenueBookingRequest(requestId, { userId: otherCoordinatorId, roles: ['coordinator'] }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });
});

describe('blocking a conflicting approval (SCRUM-155)', () => {
  /** A confirmed booking another event already holds, as a booking made before this request would be. */
  async function bookForAnotherEvent(venueId: string, date: string, slot: string) {
    const eventId = await createEvent(date, otherCoordinatorId);
    const { data } = await admin.from('event_request').select('reference').eq('id', eventId).single();
    await admin.from('venue_booking').insert({ venue_id: venueId, event_request_id: eventId, date, slot });
    return { eventId, reference: data?.reference ?? '' };
  }

  it('AC1: refuses an approval on a slot holding a confirmed booking, and names that booking (TC-155-01)', async () => {
    const venue = await createTestVenue('Hall P');
    const date = daysFromToday(20);
    const { requestId, lineIds } = await createRequest(venue.id, [{ date, slots: ['am'] }]);
    const held = await bookForAnotherEvent(venue.id, date, 'am');

    await expect(
      decideVenueBookingRequest(requestId, venueStaffId, { decisions: [{ lineId: lineIds[0], decision: 'approve' }] }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'slot_conflict' },
      message: expect.stringContaining(held.reference),
    });
    expect(await lineStatuses(requestId)).toEqual(['pending']);
  });

  it('AC3: approves once the conflicting booking has been released (TC-155-04)', async () => {
    const venue = await createTestVenue('Hall Q');
    const date = daysFromToday(20);
    const { requestId, eventId, lineIds } = await createRequest(venue.id, [{ date, slots: ['pm'] }]);
    const held = await bookForAnotherEvent(venue.id, date, 'pm');
    // Released by hand: no release action exists yet.
    await admin.from('venue_booking').delete().eq('event_request_id', held.eventId);

    const decided = await decideVenueBookingRequest(requestId, venueStaffId, {
      decisions: [{ lineId: lineIds[0], decision: 'approve' }],
    });

    expect(decided.status).toBe('approved');
    expect(await bookingsOf(eventId)).toEqual([`${date} pm confirmed`]);
  });

  it('AC4: approving one of two competing requests rejects the other, and notifies its coordinator (TC-155-06)', async () => {
    const venue = await createTestVenue('Hall R');
    const date = daysFromToday(21);
    const first = await createRequest(venue.id, [{ date, slots: ['pm'] }]);
    const second = await createRequest(venue.id, [{ date, slots: ['pm'] }], otherCoordinatorId);

    await decideVenueBookingRequest(first.requestId, venueStaffId, {
      decisions: [{ lineId: first.lineIds[0], decision: 'approve' }],
    });

    const other = await viewVenueBookingRequest(second.requestId, { userId: venueStaffId, roles: ['venue_staff'] });
    expect(other.status).toBe('rejected');
    expect(other.lines[0]).toMatchObject({ rejectionReason: SLOT_COMMITTED_REASON, decidedBy: venueStaffId });
    const { data: sent } = await admin
      .from('notifications')
      .select('type, message')
      .eq('recipient_id', otherCoordinatorId)
      .eq('event_request_id', second.eventId);
    expect(sent).toEqual([
      {
        type: 'venue_booking_update',
        message: `Your booking request for ${venue.name} was rejected for ${formatSingaporeDate(date)} PM: the slot is now committed to another event.`,
      },
    ]);
  });

  it('AC4: leaves a competing request for a different slot pending, and it can still be approved (TC-155-07)', async () => {
    const venue = await createTestVenue('Hall S');
    const date = daysFromToday(22);
    const morning = await createRequest(venue.id, [{ date, slots: ['am'] }]);
    const afternoon = await createRequest(venue.id, [{ date, slots: ['pm'] }], otherCoordinatorId);

    await decideVenueBookingRequest(morning.requestId, venueStaffId, {
      decisions: [{ lineId: morning.lineIds[0], decision: 'approve' }],
    });
    expect(await lineStatuses(afternoon.requestId)).toEqual(['pending']);

    const decided = await decideVenueBookingRequest(afternoon.requestId, venueStaffId, {
      decisions: [{ lineId: afternoon.lineIds[0], decision: 'approve' }],
    });
    expect(decided.status).toBe('approved');
  });

  it('AC5: refuses an approval on a slot recorded as unavailable, and shows the reason (TC-155-10)', async () => {
    const venue = await createTestVenue('Hall T');
    const date = daysFromToday(23);
    const { requestId, lineIds } = await createRequest(venue.id, [{ date, slots: ['am'] }]);
    await admin.from('venue_unavailable_slot').insert({ venue_id: venue.id, date, slot: 'am', reason: 'Aircon repair' });

    await expect(
      decideVenueBookingRequest(requestId, venueStaffId, { decisions: [{ lineId: lineIds[0], decision: 'approve' }] }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('unavailable: Aircon repair') });
    expect(await lineStatuses(requestId)).toEqual(['pending']);
  });

  it('AC5: the database refuses it too, if the slot is withdrawn after the check', async () => {
    const venue = await createTestVenue('Hall U');
    const date = daysFromToday(23);
    const { requestId, eventId, lineIds } = await createRequest(venue.id, [{ date, slots: ['pm'] }]);
    await admin.from('venue_unavailable_slot').insert({ venue_id: venue.id, date, slot: 'pm', reason: 'Power works' });

    const { data } = await admin.rpc('decide_venue_booking_request', {
      p_request_id: requestId,
      p_decisions: [{ line_id: lineIds[0], decision: 'approve', reason: null }],
      p_decided_by: venueStaffId,
    });

    expect(data).toMatchObject({ outcome: 'unavailable' });
    expect(await lineStatuses(requestId)).toEqual(['pending']);
    expect(await bookingsOf(eventId)).toEqual([]);
  });
});
