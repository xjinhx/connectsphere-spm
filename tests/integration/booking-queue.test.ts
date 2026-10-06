import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createVenue } from '@/domain/venues/service';
import {
  decideVenueBookingRequest,
  getVenueBookingDecision,
  listPendingBookingQueue,
  submitVenueBookingRequest,
} from '@/domain/venue-booking/service';
import type { BookingQueueEntry } from '@/domain/venue-booking/schema';
import { ensureTestClientOrganisation, TEST_CLIENT_ORGANISATION_ID } from './fixtures/clientOrganisation';

/**
 * SCRUM-147 View the pending booking request queue, against Postgres.
 *
 * AC text is from the Jira card. Test case IDs match the SCRUM-147 sheet of
 * the Sprint 2 test case workbook (TC-147-NN). Runs against the local Supabase
 * stack (`npm run db:start`, migrations applied).
 *
 * Requests are raised through SCRUM-142's real submitVenueBookingRequest and,
 * for AC3, decided through SCRUM-148's real decideVenueBookingRequest. The
 * admin client only arranges rows.
 * Other test files may add pending lines at the same time, so every check
 * looks only at this run's events.
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

let locationId: string;
const venueIds: string[] = [];
let organiserId: string;
let coordinatorId: string;
let venueStaffId: string;
const eventIds: string[] = [];

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+bq${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message}`);
  return data.user.id;
}

async function venue(name: string): Promise<string> {
  const id = (await createVenue({ name: `${name} ${RUN}`, locationId, maxCapacity: 200 })).id;
  venueIds.push(id);
  return id;
}

/** An approved event assigned to the test coordinator, the state SCRUM-142 needs to raise a request. */
async function approvedEvent(name: string): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({ organiser_id: organiserId, client_organisation_id: TEST_CLIENT_ORGANISATION_ID, name: `${name} ${RUN}` })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test event: ${error?.message}`);
  const id = data.id as string;
  eventIds.push(id);
  const steps = [
    { status: 'submitted' },
    { coordinator_id: coordinatorId, assigned_by: coordinatorId },
    { status: 'approved', decision: 'approved', decided_by: coordinatorId },
  ];
  for (const patch of steps) {
    const { error: stepError } = await admin.from('event_request').update(patch).eq('id', id);
    if (stepError) throw new Error(`could not prepare test event: ${stepError.message}`);
  }
  return id;
}

/** Raise a pending request through SCRUM-142; returns the request id. */
async function raise(eventName: string, venueId: string, lines: { date: string; timeSlots: string[] }[]) {
  const eventId = await approvedEvent(eventName);
  return (await submitVenueBookingRequest(eventId, coordinatorId, { venueId, lines })).id;
}

/** Approve or reject every pending line of a request as Venue Staff, through SCRUM-148. */
async function decide(requestId: string, decision: 'approve' | 'reject') {
  const { lines } = await getVenueBookingDecision(requestId);
  await decideVenueBookingRequest(requestId, venueStaffId, {
    decisions: lines.map((line) =>
      decision === 'approve'
        ? { lineId: line.id, decision }
        : { lineId: line.id, decision, reason: 'Venue closed for maintenance' },
    ),
  });
}

/** This run's entries only. */
async function myQueue(): Promise<BookingQueueEntry[]> {
  return (await listPendingBookingQueue()).filter((entry) => entry.eventName.endsWith(RUN));
}

const named = (entries: BookingQueueEntry[], event: string) =>
  entries.filter((entry) => entry.eventName === `${event} ${RUN}`);

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  const { data, error } = await admin.from('locations').insert({ name: `BQ Location ${RUN}` }).select('id').single();
  if (error || !data) throw new Error(`could not create test location: ${error?.message}`);
  locationId = data.id;
  organiserId = await createUser('organiser');
  coordinatorId = await createUser('coordinator');
  venueStaffId = await createUser('venuestaff');
});

afterAll(async () => {
  // Events first: their requests, lines and bookings cascade with them, a venue
  // with a request cannot be deleted, and decided_by is ON DELETE RESTRICT.
  if (eventIds.length > 0) await admin.from('event_request').delete().in('id', eventIds);
  if (venueIds.length > 0) await admin.from('venues').delete().in('id', venueIds);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
  for (const id of [organiserId, coordinatorId, venueStaffId]) {
    if (id) await admin.auth.admin.deleteUser(id);
  }
});

describe('SCRUM-147 AC1 — each pending request is listed with its details', () => {
  it('TC-147-01 / TC-147-02: lists each request once with its own venue, event, date, slots and request date', async () => {
    const ballroom = await venue('Marina Bay Ballroom');
    const seminar = await venue('Bugis Seminar Room');
    const training = await venue('Jurong East Training Room');
    await raise('Product Launch', ballroom, [{ date: '2026-10-15', timeSlots: ['pm'] }]);
    await raise('Annual Townhall', seminar, [{ date: '2026-11-20', timeSlots: ['am'] }]);
    await raise('Team Workshop', training, [{ date: '2026-10-12', timeSlots: ['am', 'pm'] }]);

    const queue = await myQueue();
    const expected = [
      ['Product Launch', 'Marina Bay Ballroom', '2026-10-15', ['pm']],
      ['Annual Townhall', 'Bugis Seminar Room', '2026-11-20', ['am']],
      ['Team Workshop', 'Jurong East Training Room', '2026-10-12', ['am', 'pm']],
    ] as const;
    for (const [event, venueName, date, slots] of expected) {
      const rows = named(queue, event);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ venueName: `${venueName} ${RUN}`, date, timeSlots: slots });
      expect(rows[0]?.eventReference).toMatch(/^EVT-\d{4}-\d{4}$/);
      expect(Number.isNaN(Date.parse(rows[0]?.requestedAt ?? ''))).toBe(false);
    }
  });

  it('lists a request with two dates as two lines, one per date', async () => {
    const hall = await venue('Two Date Hall');
    await raise('Two Day Summit', hall, [
      { date: '2026-12-01', timeSlots: ['am'] },
      { date: '2026-12-02', timeSlots: ['pm'] },
    ]);

    const rows = named(await myQueue(), 'Two Day Summit');
    expect(rows.map((row) => row.date).sort()).toEqual(['2026-12-01', '2026-12-02']);
  });
});

describe('SCRUM-147 AC2 — sorting by requested event date', () => {
  it('TC-147-04: puts the soonest event first across a year end, read from Postgres', async () => {
    const venueId = await venue('Sort Room');
    // Added in the sheet's order, so the arrival order is the reverse of the event-date order.
    await raise('New Year Kickoff', venueId, [{ date: '2027-01-02', timeSlots: ['am'] }]);
    await raise('Year-End Party', venueId, [{ date: '2026-12-30', timeSlots: ['night'] }]);
    await raise('Team Workshop', venueId, [{ date: '2026-10-12', timeSlots: ['am', 'pm'] }]);

    const mine = (await listPendingBookingQueue('event-date')).filter(
      (entry) => entry.venueName === `Sort Room ${RUN}`,
    );
    expect(mine.map((entry) => entry.eventName)).toEqual([
      `Team Workshop ${RUN}`,
      `Year-End Party ${RUN}`,
      `New Year Kickoff ${RUN}`,
    ]);
  });
});

describe('SCRUM-147 AC3 — a decided request is no longer listed (decided through SCRUM-148)', () => {
  it('TC-147-05: an approved request leaves the queue; another stays', async () => {
    const venueId = await venue('Approve Room');
    const r1 = await raise('Approve Me', venueId, [{ date: '2026-10-15', timeSlots: ['pm'] }]);
    await raise('Keep Pending A', venueId, [{ date: '2026-11-20', timeSlots: ['am'] }]);

    await decide(r1, 'approve');

    const queue = await myQueue();
    expect(named(queue, 'Approve Me')).toHaveLength(0);
    expect(named(queue, 'Keep Pending A')).toHaveLength(1);
  });

  it('TC-147-06: a rejected request leaves the queue; another stays', async () => {
    const venueId = await venue('Reject Room');
    await raise('Keep Pending B', venueId, [{ date: '2026-10-15', timeSlots: ['pm'] }]);
    const r2 = await raise('Reject Me', venueId, [{ date: '2026-11-20', timeSlots: ['am'] }]);

    await decide(r2, 'reject');

    const queue = await myQueue();
    expect(named(queue, 'Reject Me')).toHaveLength(0);
    expect(named(queue, 'Keep Pending B')).toHaveLength(1);
  });
});

describe('SCRUM-147 AC4 — every venue, for any Venue Staff member', () => {
  it('TC-147-07: lists a pending request at every venue that has one', async () => {
    const venues = [await venue('North Room'), await venue('South Room'), await venue('Harbour View Room')];
    for (const [i, venueId] of venues.entries()) {
      await raise(`Every Venue ${i}`, venueId, [{ date: '2026-11-20', timeSlots: ['pm'] }]);
    }

    const queue = await myQueue();
    for (const name of ['North Room', 'South Room', 'Harbour View Room']) {
      expect(queue.some((entry) => entry.venueName === `${name} ${RUN}`)).toBe(true);
    }
  });
});
