import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createVenue } from '@/domain/venues/service';
import { decideVenueBookingRequest, listVenueBookings, viewVenueBookingRequest } from '@/domain/venue-booking/service';
import { PERIOD_COMMITTED_REASON } from '@/domain/venue-booking/policy';
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
 * the decisions and bookings in one transaction, and venue_booking_no_overlap
 * is what refuses a double booking.
 *
 * Since SCRUM-239 Part 3, a line is a date and a start and end time, and each
 * approved line books its own period. The cases below were written for slots;
 * they keep the slots' times (AM 07:00-12:00, PM 13:00-18:00, Night
 * 19:00-24:00). SCRUM-239 AC4's own cases are in the describe at the end.
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

/** The old slots' times, for the cases written for slots. */
const AM = { start: '07:00', end: '12:00' };
const PM = { start: '13:00', end: '18:00' };
const NIGHT = { start: '19:00', end: '24:00' };

type RequestLine = { date: string; start: string; end: string } | { date: string; legacySlots: string[] };

/**
 * A pending booking request, made the way SCRUM-142's form makes one: each
 * line a date and a start and end time. A line given `legacySlots` is written
 * as one from before the switch to times. Line ids come back in the order given.
 */
async function createRequest(venueId: string, lines: RequestLine[], coordinator = coordinatorId) {
  const eventId = await createEvent(lines[0]!.date, coordinator);
  const { data: requestId, error } = await admin.rpc('create_venue_booking_request', {
    p_event_request_id: eventId,
    p_venue_id: venueId,
    p_requested_by: coordinator,
    p_lines: lines.map((line) => ('legacySlots' in line ? { date: line.date, time_slots: line.legacySlots } : line)),
  });
  if (error || !requestId) throw new Error(`could not create test request: ${error?.message}`);
  const { data: rows } = await admin
    .from('venue_booking_request_line')
    .select('id, date, start_time, end_time, time_slots')
    .eq('request_id', requestId);
  const used = new Set<string>();
  const lineIds = lines.map((line) => {
    const match = (rows ?? []).find(
      (row) =>
        !used.has(row.id) &&
        row.date === line.date &&
        ('legacySlots' in line
          ? row.time_slots?.join() === line.legacySlots.join()
          : row.start_time === `${line.start}:00` && row.end_time === `${line.end}:00`),
    );
    if (!match) throw new Error('could not find test request line');
    used.add(match.id);
    return match.id;
  });
  return { requestId: requestId as string, eventId, lineIds };
}

/** "2026-10-22 07:00-12:00 confirmed", one per booking. */
async function bookingsOf(eventId: string) {
  const { data } = await admin.from('venue_booking').select('date, start_time, end_time, status').eq('event_request_id', eventId);
  return (data ?? []).map((row) => `${row.date} ${row.start_time.slice(0, 5)}-${row.end_time.slice(0, 5)} ${row.status}`).sort();
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
    const { requestId, lineIds } = await createRequest(venue.id, [{ date: daysFromToday(10), ...AM }]);

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

  it("AC2: creates a confirmed booking for the venue for the approved line's whole period", async () => {
    const venue = await createTestVenue('Hall B');
    const date = daysFromToday(10);
    const { requestId, eventId, lineIds } = await createRequest(venue.id, [{ date, start: '07:00', end: '18:00' }]);

    await decideVenueBookingRequest(requestId, venueStaffId, { decisions: [{ lineId: lineIds[0], decision: 'approve' }] });

    expect(await bookingsOf(eventId)).toEqual([`${date} 07:00-18:00 confirmed`]);
  });

  it("AC2: notifies the event's assigned coordinator of the decision", async () => {
    const venue = await createTestVenue('Hall N');
    const date = daysFromToday(11);
    const { requestId, eventId, lineIds } = await createRequest(venue.id, [{ date, ...AM }]);

    await decideVenueBookingRequest(requestId, venueStaffId, { decisions: [{ lineId: lineIds[0], decision: 'approve' }] });

    const { data } = await admin
      .from('notifications')
      .select('type, message')
      .eq('recipient_id', coordinatorId)
      .eq('event_request_id', eventId);
    expect(data).toEqual([{ type: 'venue_booking_update', message: `Your booking request for ${venue.name} was approved: ${formatSingaporeDate(date)} 07:00–12:00.` }]);
  });

  it('AC5: approves some lines and rejects one with a reason: Partially Approved, bookings for approved lines only', async () => {
    const venue = await createTestVenue('Hall C');
    const date = daysFromToday(11);
    const { requestId, eventId, lineIds } = await createRequest(venue.id, [
      { date, ...AM },
      { date, ...PM },
      { date, ...NIGHT },
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
    expect(await bookingsOf(eventId)).toEqual([`${date} 07:00-12:00 confirmed`, `${date} 13:00-18:00 confirmed`]);
  });

  it('AC5: refuses a rejected line without a reason, and changes nothing', async () => {
    const venue = await createTestVenue('Hall D');
    const date = daysFromToday(11);
    const { requestId, eventId, lineIds } = await createRequest(venue.id, [{ date, ...AM }, { date, ...NIGHT }]);

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

  it('AC5: the database itself refuses a rejected line with no reason (SCRUM-244)', async () => {
    const venue = await createTestVenue('Reasonless Hall');
    const { requestId, lineIds } = await createRequest(venue.id, [{ date: daysFromToday(19), ...AM }]);

    // Written straight to the table, past the app's own check, as SCRUM-244's steps do.
    const { error } = await admin
      .from('venue_booking_request_line')
      .update({ status: 'rejected', decided_by: venueStaffId, decided_at: new Date().toISOString(), rejection_reason: null })
      .eq('id', lineIds[0]!);

    expect(error?.code).toBe('23514');
    expect(await lineStatuses(requestId)).toEqual(['pending']);
  });

  it('approving every line gives Approved, not Partially Approved', async () => {
    const venue = await createTestVenue('Hall E');
    const date = daysFromToday(12);
    const { requestId, eventId, lineIds } = await createRequest(venue.id, [
      { date, ...AM },
      { date, ...PM },
      { date, ...NIGHT },
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
    const { requestId, eventId, lineIds } = await createRequest(venue.id, [{ date, ...AM }, { date, ...PM }]);

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
    const { requestId, lineIds } = await createRequest(venue.id, [{ date, ...AM }, { date, ...PM }]);

    await expect(
      decideVenueBookingRequest(requestId, venueStaffId, { decisions: [{ lineId: lineIds[0], decision: 'approve' }] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await lineStatuses(requestId)).toEqual(['pending', 'pending']);
  });

  it('refuses to decide a request twice', async () => {
    const venue = await createTestVenue('Hall H');
    const { requestId, lineIds } = await createRequest(venue.id, [{ date: daysFromToday(13), ...AM }]);
    const decision = { decisions: [{ lineId: lineIds[0], decision: 'approve' }] };
    await decideVenueBookingRequest(requestId, venueStaffId, decision);

    await expect(decideVenueBookingRequest(requestId, venueStaffId, decision)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'already_decided' },
    });
  });

  it('AC1 "with no conflict": the database refuses a period overlapping a confirmed booking, and saves nothing', async () => {
    const venue = await createTestVenue('Hall I');
    const date = daysFromToday(14);
    const first = await createRequest(venue.id, [{ date, ...PM }]);
    await decideVenueBookingRequest(first.requestId, venueStaffId, { decisions: [{ lineId: first.lineIds[0], decision: 'approve' }] });
    const second = await createRequest(venue.id, [{ date, start: '07:00', end: '18:00' }]);

    // Straight to the database function, past the service's check (SCRUM-155,
    // SCRUM-239 AC4): venue_booking_no_overlap is the guarantee underneath it.
    const { error } = await admin.rpc('decide_venue_booking_request', {
      p_request_id: second.requestId,
      p_decisions: [{ line_id: second.lineIds[0], decision: 'approve', reason: null }],
      p_decided_by: venueStaffId,
    });
    expect(error?.code).toBe('23P01');

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
    const { requestId, lineIds } = await createRequest(venueId, [{ date, ...AM }]);
    await decideVenueBookingRequest(requestId, venueStaffId, { decisions: [{ lineId: lineIds[0], decision: 'approve' }] });
  });

  const STRANGER = '55555555-5555-4555-8555-555555555555';

  it.each([
    ['Venue Staff', () => ({ userId: STRANGER, roles: ['venue_staff' as const] })],
    ['an Event Operations Manager', () => ({ userId: STRANGER, roles: ['operations_manager' as const] })],
    ["the event's assigned coordinator", () => ({ userId: coordinatorId, roles: ['coordinator' as const] })],
  ])('AC3: %s sees the booking at its times, confirmed, with its event reference', async (_who, actor) => {
    const [booking] = await listVenueBookings(venueId, { from: date, to: date }, actor());
    expect(booking).toMatchObject({ date, ...AM, state: 'confirmed', event: { reference: expect.stringMatching(/^EVT-/) } });
  });

  it.each([
    ['a coordinator not assigned to the event', ['coordinator' as const]],
    ['Technical Support Staff', ['technical_support' as const]],
  ])('AC4: %s sees the period as committed, with no event details', async (_who, roles) => {
    const bookings = await listVenueBookings(venueId, { from: date, to: date }, { userId: STRANGER, roles });
    expect(bookings).toEqual([{ date, ...AM, state: 'committed' }]);
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
    const { requestId, eventId, lineIds } = await createRequest(venue.id, [{ date, ...PM }]);

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
        message: `Your booking request for ${venue.name} was rejected: ${formatSingaporeDate(date)} 13:00–18:00 (Capacity is 80, event needs 150).`,
      },
    ]);
  });

  it('AC2: refuses a rejection without a reason, and the request stays Pending (TC-149-03)', async () => {
    const venue = await createTestVenue('Hall L');
    const { requestId, lineIds } = await createRequest(venue.id, [{ date: daysFromToday(16), ...AM }]);

    await expect(
      decideVenueBookingRequest(requestId, venueStaffId, { decisions: [{ lineId: lineIds[0], decision: 'reject', reason: '' }] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'A reason is required for each rejected line.' });
    expect(await lineStatuses(requestId)).toEqual(['pending']);
  });

  describe('AC3: the coordinator sees the reason and who decided (TC-149-02)', () => {
    let requestId: string;

    beforeAll(async () => {
      const venue = await createTestVenue('Hall M');
      const created = await createRequest(venue.id, [{ date: daysFromToday(17), ...PM }]);
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
    const { requestId, lineIds } = await createRequest(venue.id, [{ date, ...AM }]);
    const held = await bookForAnotherEvent(venue.id, date, 'am');

    await expect(
      decideVenueBookingRequest(requestId, venueStaffId, { decisions: [{ lineId: lineIds[0], decision: 'approve' }] }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'period_conflict' },
      message: expect.stringContaining(held.reference),
    });
    expect(await lineStatuses(requestId)).toEqual(['pending']);
  });

  it('AC3: approves once the conflicting booking has been released (TC-155-04)', async () => {
    const venue = await createTestVenue('Hall Q');
    const date = daysFromToday(20);
    const { requestId, eventId, lineIds } = await createRequest(venue.id, [{ date, ...PM }]);
    const held = await bookForAnotherEvent(venue.id, date, 'pm');
    // Released by hand: no release action exists yet.
    await admin.from('venue_booking').delete().eq('event_request_id', held.eventId);

    const decided = await decideVenueBookingRequest(requestId, venueStaffId, {
      decisions: [{ lineId: lineIds[0], decision: 'approve' }],
    });

    expect(decided.status).toBe('approved');
    expect(await bookingsOf(eventId)).toEqual([`${date} 13:00-18:00 confirmed`]);
  });

  it('AC4: approving one of two competing requests rejects the other, and notifies its coordinator (TC-155-06)', async () => {
    const venue = await createTestVenue('Hall R');
    const date = daysFromToday(21);
    const first = await createRequest(venue.id, [{ date, ...PM }]);
    const second = await createRequest(venue.id, [{ date, ...PM }], otherCoordinatorId);

    await decideVenueBookingRequest(first.requestId, venueStaffId, {
      decisions: [{ lineId: first.lineIds[0], decision: 'approve' }],
    });

    const other = await viewVenueBookingRequest(second.requestId, { userId: venueStaffId, roles: ['venue_staff'] });
    expect(other.status).toBe('rejected');
    expect(other.lines[0]).toMatchObject({ rejectionReason: PERIOD_COMMITTED_REASON, decidedBy: venueStaffId });
    const { data: sent } = await admin
      .from('notifications')
      .select('type, message')
      .eq('recipient_id', otherCoordinatorId)
      .eq('event_request_id', second.eventId);
    expect(sent).toEqual([
      {
        type: 'venue_booking_update',
        message: `Your booking request for ${venue.name} was rejected for ${formatSingaporeDate(date)} 13:00–18:00: the period is now committed to another event.`,
      },
    ]);
  });

  it('AC4: leaves a competing request for a period that does not overlap pending, and it can still be approved (TC-155-07)', async () => {
    const venue = await createTestVenue('Hall S');
    const date = daysFromToday(22);
    const morning = await createRequest(venue.id, [{ date, ...AM }]);
    const afternoon = await createRequest(venue.id, [{ date, ...PM }], otherCoordinatorId);

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
    const { requestId, lineIds } = await createRequest(venue.id, [{ date, ...AM }]);
    await admin.from('venue_unavailable_slot').insert({ venue_id: venue.id, date, slot: 'am', reason: 'Aircon repair' });

    await expect(
      decideVenueBookingRequest(requestId, venueStaffId, { decisions: [{ lineId: lineIds[0], decision: 'approve' }] }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('unavailable: Aircon repair') });
    expect(await lineStatuses(requestId)).toEqual(['pending']);
  });

  it('AC5: the database refuses it too, if the slot is withdrawn after the check', async () => {
    const venue = await createTestVenue('Hall U');
    const date = daysFromToday(23);
    const { requestId, eventId, lineIds } = await createRequest(venue.id, [{ date, ...PM }]);
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

describe('suggesting an alternative (SCRUM-150)', () => {
  let requestId: string;
  let eventId: string;
  let lineId: string;
  let suggested: { id: string; name: string };
  let date: string;

  beforeAll(async () => {
    const venue = await createTestVenue('Hall V');
    const other = await createTestVenue('Hall W');
    suggested = { id: other.id, name: other.name };
    date = daysFromToday(30);
    const created = await createRequest(venue.id, [{ date, ...PM }]);
    requestId = created.requestId;
    eventId = created.eventId;
    lineId = created.lineIds[0]!;
    await decideVenueBookingRequest(requestId, venueStaffId, {
      decisions: [{ lineId, decision: 'reject', reason: 'Too small', suggestion: { venueId: suggested.id, date, ...PM } }],
    });
  });

  it('AC1: keeps the suggestion with the rejected line (TC-150-01)', async () => {
    const seen = await viewVenueBookingRequest(requestId, { userId: venueStaffId, roles: ['venue_staff'] });

    expect(seen.status).toBe('rejected');
    expect(seen.lines[0]).toMatchObject({
      rejectionReason: 'Too small',
      suggestion: { venueId: suggested.id, venueName: suggested.name, date, ...PM },
    });
  });

  it("AC2: shows it to the event's coordinator (TC-150-02)", async () => {
    const seen = await viewVenueBookingRequest(requestId, { userId: coordinatorId, roles: ['coordinator'] });
    expect(seen.lines[0]?.suggestion).toMatchObject({ venueName: suggested.name, date, ...PM });
  });

  it('AC3: books nothing and requests nothing at the suggested venue (TC-150-04)', async () => {
    const { count: bookings } = await admin
      .from('venue_booking')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', suggested.id)
      .eq('date', date);
    const { count: requests } = await admin
      .from('venue_booking_request')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', suggested.id)
      .eq('event_request_id', eventId);

    expect(bookings).toBe(0);
    expect(requests).toBe(0);
  });

  it("AC3: does not hold the suggested period: another event's request for it is approved normally (TC-150-05)", async () => {
    const competing = await createRequest(suggested.id, [{ date, ...PM }], otherCoordinatorId);

    const decided = await decideVenueBookingRequest(competing.requestId, venueStaffId, {
      decisions: [{ lineId: competing.lineIds[0], decision: 'approve' }],
    });
    expect(decided.status).toBe('approved');
  });

  it('AC1: a rejection without a suggestion has none (TC-150-06)', async () => {
    const venue = await createTestVenue('Hall X');
    const plain = await createRequest(venue.id, [{ date: daysFromToday(31), ...AM }]);

    const decided = await decideVenueBookingRequest(plain.requestId, venueStaffId, {
      decisions: [{ lineId: plain.lineIds[0], decision: 'reject', reason: 'Private function' }],
    });
    expect(decided.lines[0]?.suggestion).toBeNull();
  });
});

/**
 * SCRUM-239 Part 3/4 — approval in exact times (Jira, authoritative).
 * AC4: "Given a request was submitted before an overlapping booking was
 * confirmed, when Venue Staff tries to approve it, then approval is refused
 * and the clashing period and the event holding it are named (as SCRUM-155
 * AC1)."
 * SCRUM-227 AC4 and AC5: another event's active hold blocks the approval; the
 * event's own hold does not, and the booking closes it.
 * PR #89 follow-up, decided: a line from before the switch asking for AM and
 * Night is refused, not booked as 07:00-24:00.
 * Test case IDs are from ConnectSphere_TestCases_Sprint3_238_239_226.xlsx.
 */
describe('SCRUM-239 AC4: approval in exact times', () => {
  async function eventReference(eventId: string) {
    const { data } = await admin.from('event_request').select('reference, name').eq('id', eventId).single();
    return data as { reference: string; name: string };
  }

  async function hold(venueId: string, eventId: string, date: string, start: string, end: string) {
    const { data, error } = await admin
      .from('venue_hold')
      .insert({
        venue_id: venueId,
        event_request_id: eventId,
        date,
        start_time: start,
        end_time: end,
        expires_at: new Date(Date.now() + 72 * 3_600_000).toISOString(),
        created_by: venueStaffId,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`could not hold test period: ${error?.message}`);
    return data.id as string;
  }

  it('TC-239-10: refuses approving 11:00-13:00 after 10:00-12:00 was confirmed, naming the period and the event holding it', async () => {
    const venue = await createTestVenue('AC4 Hall A');
    const date = daysFromToday(40);
    // A is submitted first; then another event's booking 10:00-12:00 is
    // confirmed, written as an approval leaves it (as SCRUM-155's cases do).
    const a = await createRequest(venue.id, [{ date, start: '11:00', end: '13:00' }]);
    const holderId = await createEvent(date, otherCoordinatorId);
    const { error } = await admin
      .from('venue_booking')
      .insert({ venue_id: venue.id, event_request_id: holderId, date, start_time: '10:00', end_time: '12:00' });
    if (error) throw new Error(`could not book test period: ${error.message}`);
    const holder = await eventReference(holderId);

    await expect(
      decideVenueBookingRequest(a.requestId, venueStaffId, { decisions: [{ lineId: a.lineIds[0], decision: 'approve' }] }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: `This request cannot be approved. 10:00–12:00 on ${formatSingaporeDate(date)} is already booked for ${holder.reference} (${holder.name}).`,
      details: { reason: 'period_conflict' },
    });
    expect(await lineStatuses(a.requestId)).toEqual(['pending']);
    expect(await bookingsOf(a.eventId)).toEqual([]);
  });

  it('TC-239-11: approves a pending 12:00-14:00 next to a confirmed 10:00-12:00, as Confirmed', async () => {
    const venue = await createTestVenue('AC4 Hall B');
    const date = daysFromToday(41);
    const first = await createRequest(venue.id, [{ date, start: '10:00', end: '12:00' }], otherCoordinatorId);
    const second = await createRequest(venue.id, [{ date, start: '12:00', end: '14:00' }]);
    await decideVenueBookingRequest(first.requestId, venueStaffId, { decisions: [{ lineId: first.lineIds[0], decision: 'approve' }] });
    // Touching, not overlapping: SCRUM-155 AC4 leaves it pending.
    expect(await lineStatuses(second.requestId)).toEqual(['pending']);

    const decided = await decideVenueBookingRequest(second.requestId, venueStaffId, {
      decisions: [{ lineId: second.lineIds[0], decision: 'approve' }],
    });

    expect(decided.status).toBe('approved');
    expect(await bookingsOf(second.eventId)).toEqual([`${date} 12:00-14:00 confirmed`]);
  });

  it('SCRUM-155 AC4 in times: approving one request rejects another that overlaps it by 15 minutes', async () => {
    const venue = await createTestVenue('AC4 Hall C');
    const date = daysFromToday(42);
    const first = await createRequest(venue.id, [{ date, start: '10:00', end: '12:00' }]);
    const second = await createRequest(venue.id, [{ date, start: '11:45', end: '13:00' }], otherCoordinatorId);

    await decideVenueBookingRequest(first.requestId, venueStaffId, { decisions: [{ lineId: first.lineIds[0], decision: 'approve' }] });

    const other = await viewVenueBookingRequest(second.requestId, { userId: venueStaffId, roles: ['venue_staff'] });
    expect(other.lines[0]).toMatchObject({ status: 'rejected', rejectionReason: PERIOD_COMMITTED_REASON });
  });

  it("SCRUM-227 AC4: refuses an approval over another event's active hold, naming the hold", async () => {
    const venue = await createTestVenue('AC4 Hall D');
    const date = daysFromToday(43);
    const request = await createRequest(venue.id, [{ date, start: '10:00', end: '12:00' }]);
    const holderId = await createEvent(date, otherCoordinatorId);
    await hold(venue.id, holderId, date, '11:00', '13:00');
    const holder = await eventReference(holderId);

    await expect(
      decideVenueBookingRequest(request.requestId, venueStaffId, { decisions: [{ lineId: request.lineIds[0], decision: 'approve' }] }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining(`11:00–13:00 on ${formatSingaporeDate(date)} is held for ${holder.reference} (${holder.name}) until`),
    });
    expect(await lineStatuses(request.requestId)).toEqual(['pending']);
  });

  it("SCRUM-227 AC5: approves the holding event's own request and closes its hold", async () => {
    const venue = await createTestVenue('AC4 Hall E');
    const date = daysFromToday(44);
    const request = await createRequest(venue.id, [{ date, start: '10:00', end: '12:00' }]);
    const holdId = await hold(venue.id, request.eventId, date, '10:00', '12:00');

    const decided = await decideVenueBookingRequest(request.requestId, venueStaffId, {
      decisions: [{ lineId: request.lineIds[0], decision: 'approve' }],
    });

    expect(decided.status).toBe('approved');
    expect(await bookingsOf(request.eventId)).toEqual([`${date} 10:00-12:00 confirmed`]);
    const { data } = await admin.from('venue_hold').select('status').eq('id', holdId).single();
    expect(data?.status).toBe('closed');
  });

  it("the database also refuses another event's hold, if it is placed after the check", async () => {
    const venue = await createTestVenue('AC4 Hall F');
    const date = daysFromToday(45);
    const request = await createRequest(venue.id, [{ date, start: '10:00', end: '12:00' }]);
    await hold(venue.id, await createEvent(date, otherCoordinatorId), date, '11:00', '12:00');

    const { data } = await admin.rpc('decide_venue_booking_request', {
      p_request_id: request.requestId,
      p_decisions: [{ line_id: request.lineIds[0], decision: 'approve', reason: null }],
      p_decided_by: venueStaffId,
    });

    expect(data).toMatchObject({ outcome: 'held' });
    expect(await lineStatuses(request.requestId)).toEqual(['pending']);
  });

  it('PR #89 follow-up: refuses approving a line from before the switch that asks for AM and Night', async () => {
    const venue = await createTestVenue('AC4 Hall G');
    const date = daysFromToday(46);
    const legacy = await createRequest(venue.id, [{ date, legacySlots: ['am', 'night'] }]);

    await expect(
      decideVenueBookingRequest(legacy.requestId, venueStaffId, { decisions: [{ lineId: legacy.lineIds[0], decision: 'approve' }] }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('AM and Night') });

    const { data } = await admin.rpc('decide_venue_booking_request', {
      p_request_id: legacy.requestId,
      p_decisions: [{ line_id: legacy.lineIds[0], decision: 'approve', reason: null }],
      p_decided_by: venueStaffId,
    });
    expect(data).toMatchObject({ outcome: 'non_adjacent_slots' });
    expect(await bookingsOf(legacy.eventId)).toEqual([]);

    // Rejecting it still works.
    const decided = await decideVenueBookingRequest(legacy.requestId, venueStaffId, {
      decisions: [{ lineId: legacy.lineIds[0], decision: 'reject', reason: 'Request each period separately' }],
    });
    expect(decided.status).toBe('rejected');
  });

  it('a line from before the switch asking for AM and PM is booked as 07:00-18:00 (AC7)', async () => {
    const venue = await createTestVenue('AC4 Hall H');
    const date = daysFromToday(47);
    const legacy = await createRequest(venue.id, [{ date, legacySlots: ['am', 'pm'] }]);

    await decideVenueBookingRequest(legacy.requestId, venueStaffId, { decisions: [{ lineId: legacy.lineIds[0], decision: 'approve' }] });

    expect(await bookingsOf(legacy.eventId)).toEqual([`${date} 07:00-18:00 confirmed`]);
  });
});
