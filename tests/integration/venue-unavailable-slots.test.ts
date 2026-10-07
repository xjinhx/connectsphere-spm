import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createVenue } from '@/domain/venues/service';
import {
  findUnavailableSlots,
  listAffectedBookings,
  listUpcomingUnavailableSlots,
  markSlotsUnavailable,
} from '@/domain/availability/service';
import { formatSingaporeDate, todayInSingapore } from '@/domain/shared/dates';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-151 Withdraw venue availability when circumstances change: AC1 to AC3.
 *
 * AC1 (Jira, authoritative): "Given I select a venue, a date and the affected
 * slots and record a reason, when I save, then those slots are recorded as
 * unavailable and are no longer offered for new bookings."
 * AC2: "Given an affected slot carries a confirmed booking for an upcoming
 * event, when I save the change, then the booking is flagged as affected and
 * the assigned Event Coordinator is notified with the reason."
 * AC3: "Given a coordinator has been notified of an affected booking, when
 * they open the event, then the affected booking is listed with an
 * outstanding action until they release or replace it."
 *
 * Nothing releases a single booking yet (stand-in D-12), so these tests remove
 * the booking by hand, as a tester would, and check "released" and "replaced"
 * separately.
 *
 * "No longer offered" has no booking request or search to run through yet
 * (SCRUM-142, 154, 128 are this sprint's). What those stories will ask is
 * findUnavailableSlots, so that is tested directly here, and the check is
 * re-run end to end once they call it.
 *
 * AC2's bookings are stand-in D-04 (venue_booking, added by hand here as a
 * tester would). Its notice is a venue_unavailability_notice row, sent to the
 * coordinator as a SCRUM-193 notification. See docs/dummies.md.
 *
 * Runs against the local Supabase stack: the unique constraint is what makes
 * a save with a slot already unavailable save nothing at all, and
 * mark_slots_unavailable writes the notices in the same transaction as the
 * slots. The admin client only arranges and reads rows.
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let locationId: string;
let venueStaffId: string;
let organiserId: string;
let coordinatorId: string;
const venueIds: string[] = [];
const requestIds: string[] = [];

/** The Singapore date `days` from today, as YYYY-MM-DD. */
function daysFromToday(days: number): string {
  const date = new Date(`${todayInSingapore()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A venue of this file's own. It operates AM and PM only, so Night can be refused. */
async function createTestVenue(label: string) {
  const venue = await createVenue({ name: `${label} ${RUN}`, locationId, maxCapacity: 100, operatingSlots: ['am', 'pm'] });
  venueIds.push(venue.id);
  return venue;
}

async function rowsFor(venueId: string) {
  const { data, error } = await admin
    .from('venue_unavailable_slot')
    .select('date, slot, reason, recorded_by')
    .eq('venue_id', venueId);
  if (error || !data) throw new Error(`could not read unavailable slots: ${error?.message}`);
  return data;
}

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+unavailable${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user returned'}`);
  return data.user.id;
}

/**
 * A confirmed booking of an event into the venue, made by hand as a tester
 * would (stand-in D-04). The booking has no date or slot of its own: both come
 * from the event. The assignment is an update after the submission, because
 * event_request_assignment_needs_submission refuses a coordinator on a draft.
 */
async function bookEvent(
  venueId: string,
  { date, slots, coordinator }: { date: string; slots: string[]; coordinator: string | null },
): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: CLIENT_ORGANISATION_ID,
      name: `Unavailable Slot Event ${RUN}`,
      proposed_date: date,
      time_slots: slots,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test request: ${error?.message}`);
  const id = data.id;
  requestIds.push(id);

  const { error: submitError } = await admin.from('event_request').update({ status: 'submitted' }).eq('id', id);
  if (submitError) throw new Error(`could not submit test request: ${submitError.message}`);

  if (coordinator) {
    const { error: assignError } = await admin
      .from('event_request')
      .update({ coordinator_id: coordinator, assigned_by: coordinator })
      .eq('id', id);
    if (assignError) throw new Error(`could not assign test request: ${assignError.message}`);
  }

  const { error: bookError } = await admin.from('venue_booking').insert({ venue_id: venueId, event_request_id: id });
  if (bookError) throw new Error(`could not book test request: ${bookError.message}`);
  return id;
}

async function noticesFor(eventId: string) {
  const { data, error } = await admin
    .from('venue_unavailability_notice')
    .select('coordinator_id, slot_date, slots, reason')
    .eq('event_request_id', eventId);
  if (error || !data) throw new Error(`could not read notices: ${error?.message}`);
  return data;
}

/** AC2's flag: the slots on which the event's booking is affected. */
async function affectedSlotsOf(eventId: string) {
  const { data, error } = await admin.from('affected_booking_slot').select('slot').eq('event_request_id', eventId);
  if (error || !data) throw new Error(`could not read affected bookings: ${error?.message}`);
  return data.map((row) => row.slot).sort();
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);

  const { data: location, error } = await admin
    .from('locations')
    .insert({ name: `Unavailable Slots Location ${RUN}` })
    .select('id')
    .single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;

  venueStaffId = await createUser('venue-staff');
  organiserId = await createUser('organiser');
  coordinatorId = await createUser('coordinator');
});

afterAll(async () => {
  // Requests first: their bookings and notices go with them (cascade), and
  // venue_booking holds on to its venue (restrict). Then venues, whose
  // unavailable slots go with them. Accounts last: recorded_by and the
  // notices' coordinator_id are ON DELETE RESTRICT.
  for (const id of requestIds) {
    await admin.from('event_request').delete().eq('id', id);
  }
  for (const id of venueIds) {
    await admin.from('venues').delete().eq('id', id);
  }
  for (const id of [venueStaffId, organiserId, coordinatorId]) {
    if (id) await admin.auth.admin.deleteUser(id);
  }
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
});

describe('markSlotsUnavailable (SCRUM-151 AC1)', () => {
  it('records each ticked slot as its own unavailable slot, with the reason and who recorded it', async () => {
    const venue = await createTestVenue('Hall A');
    const date = daysFromToday(5);

    const saved = await markSlotsUnavailable(
      venue.id,
      { date, slots: ['pm', 'am'], reason: '  Ceiling repair ' },
      venueStaffId,
    );

    expect(saved.unavailableSlots.map((entry) => entry.slot)).toEqual(['am', 'pm']);
    const rows = await rowsFor(venue.id);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({ date, reason: 'Ceiling repair', recorded_by: venueStaffId });
    }
  });

  it('refuses a save that includes a slot already unavailable, names it, and saves none of the others', async () => {
    const venue = await createTestVenue('Hall B');
    const date = daysFromToday(5);
    await markSlotsUnavailable(venue.id, { date, slots: ['am'], reason: 'Power outage' }, venueStaffId);

    await expect(
      markSlotsUnavailable(venue.id, { date, slots: ['am', 'pm'], reason: 'Ceiling repair' }, venueStaffId),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('AM on'),
      details: { reason: 'already_unavailable' },
    });

    // PM was not saved, and AM still carries its first reason.
    const rows = await rowsFor(venue.id);
    expect(rows).toEqual([expect.objectContaining({ slot: 'am', reason: 'Power outage' })]);
  });

  it('refuses a slot the venue does not operate, and saves nothing', async () => {
    const venue = await createTestVenue('Hall C');

    await expect(
      markSlotsUnavailable(venue.id, { date: daysFromToday(5), slots: ['pm', 'night'], reason: 'Flooding' }, venueStaffId),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('Night') });
    expect(await rowsFor(venue.id)).toEqual([]);
  });

  it('refuses a blank reason before writing anything', async () => {
    const venue = await createTestVenue('Hall D');

    await expect(
      markSlotsUnavailable(venue.id, { date: daysFromToday(5), slots: ['am'], reason: '   ' }, venueStaffId),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'A reason is required.' });
    expect(await rowsFor(venue.id)).toEqual([]);
  });

  it('reports an unknown venue as not found', async () => {
    await expect(
      markSlotsUnavailable(
        '99999999-9999-4999-8999-999999999999',
        { date: daysFromToday(5), slots: ['am'], reason: 'Ceiling repair' },
        venueStaffId,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('findUnavailableSlots: the check other stories ask (SCRUM-151 AC1, "no longer offered")', () => {
  it('answers which slots are unavailable on a date, each with its recorded reason', async () => {
    const venue = await createTestVenue('Hall E');
    const date = daysFromToday(7);
    await markSlotsUnavailable(venue.id, { date, slots: ['am'], reason: 'Ceiling repair' }, venueStaffId);

    const unavailable = await findUnavailableSlots(venue.id, date, ['am', 'pm']);
    expect(unavailable.map(({ slot, reason }) => ({ slot, reason }))).toEqual([
      { slot: 'am', reason: 'Ceiling repair' },
    ]);
  });

  it('finds nothing for a slot that was not withdrawn, or on another date', async () => {
    const venue = await createTestVenue('Hall F');
    const date = daysFromToday(7);
    await markSlotsUnavailable(venue.id, { date, slots: ['am'], reason: 'Ceiling repair' }, venueStaffId);

    expect(await findUnavailableSlots(venue.id, date, ['pm'])).toEqual([]);
    expect(await findUnavailableSlots(venue.id, daysFromToday(8))).toEqual([]);
  });
});

describe('affected bookings and their coordinators (SCRUM-151 AC2)', () => {
  it('flags a confirmed upcoming booking on a withdrawn slot, and notifies its coordinator with the reason', async () => {
    const venue = await createTestVenue('Hall H');
    const date = daysFromToday(10);
    const eventId = await bookEvent(venue.id, { date, slots: ['am', 'pm'], coordinator: coordinatorId });

    const outcome = await markSlotsUnavailable(venue.id, { date, slots: ['am'], reason: 'Ceiling repair' }, venueStaffId);

    expect(outcome.notifiedBookings).toBe(1);
    expect(await affectedSlotsOf(eventId)).toEqual(['am']);
    expect(await noticesFor(eventId)).toEqual([
      { coordinator_id: coordinatorId, slot_date: date, slots: ['am'], reason: 'Ceiling repair' },
    ]);
    const { data: sent } = await admin.from('notifications').select('recipient_id, type, message').eq('event_request_id', eventId);
    expect(sent).toEqual([
      {
        recipient_id: coordinatorId,
        type: 'venue_booking_update',
        message: `Your booking at ${venue.name} is affected: ${formatSingaporeDate(date)} AM is no longer available (Ceiling repair).`,
      },
    ]);
  });

  it('leaves the event not cancelled, with its status unchanged (AC2, Week 7 change #2)', async () => {
    const venue = await createTestVenue('Hall T');
    const date = daysFromToday(10);
    const eventId = await bookEvent(venue.id, { date, slots: ['am'], coordinator: coordinatorId });
    const statusOf = async () => (await admin.from('event_request').select('status').eq('id', eventId).single()).data?.status;
    const before = await statusOf();

    await markSlotsUnavailable(venue.id, { date, slots: ['am'], reason: 'Ceiling repair' }, venueStaffId);

    expect(await affectedSlotsOf(eventId)).toEqual(['am']);
    expect(await statusOf()).toBe(before);
    expect(await statusOf()).not.toBe('cancelled');
  });

  it('sends one notice per booking, naming every withdrawn slot the event uses', async () => {
    const venue = await createTestVenue('Hall I');
    const date = daysFromToday(10);
    const eventId = await bookEvent(venue.id, { date, slots: ['am', 'pm'], coordinator: coordinatorId });

    await markSlotsUnavailable(venue.id, { date, slots: ['pm', 'am'], reason: 'Flooding' }, venueStaffId);

    expect(await noticesFor(eventId)).toEqual([expect.objectContaining({ slots: ['am', 'pm'], reason: 'Flooding' })]);
  });

  it('leaves bookings on another slot or another date alone', async () => {
    const venue = await createTestVenue('Hall J');
    const date = daysFromToday(10);
    const otherSlot = await bookEvent(venue.id, { date, slots: ['pm'], coordinator: coordinatorId });
    const otherDate = await bookEvent(venue.id, { date: daysFromToday(11), slots: ['am'], coordinator: coordinatorId });

    const outcome = await markSlotsUnavailable(venue.id, { date, slots: ['am'], reason: 'Ceiling repair' }, venueStaffId);

    expect(outcome.notifiedBookings).toBe(0);
    for (const eventId of [otherSlot, otherDate]) {
      expect(await affectedSlotsOf(eventId)).toEqual([]);
      expect(await noticesFor(eventId)).toEqual([]);
    }
  });

  it('does not notify anyone about an event that has already happened', async () => {
    const venue = await createTestVenue('Hall K');
    const yesterday = daysFromToday(-1);
    const eventId = await bookEvent(venue.id, { date: yesterday, slots: ['am'], coordinator: coordinatorId });

    const outcome = await markSlotsUnavailable(venue.id, { date: yesterday, slots: ['am'], reason: 'Late record' }, venueStaffId);

    expect(outcome.notifiedBookings).toBe(0);
    expect(await noticesFor(eventId)).toEqual([]);
  });

  it('still flags a booking whose event has no coordinator, with nobody to notify', async () => {
    const venue = await createTestVenue('Hall L');
    const date = daysFromToday(10);
    const eventId = await bookEvent(venue.id, { date, slots: ['am'], coordinator: null });

    const outcome = await markSlotsUnavailable(venue.id, { date, slots: ['am'], reason: 'Ceiling repair' }, venueStaffId);

    expect(outcome.notifiedBookings).toBe(0);
    expect(await affectedSlotsOf(eventId)).toEqual(['am']);
    expect(await noticesFor(eventId)).toEqual([]);
  });

  it('writes no notice when the save is refused for a slot already unavailable', async () => {
    const venue = await createTestVenue('Hall M');
    const date = daysFromToday(10);
    const eventId = await bookEvent(venue.id, { date, slots: ['am', 'pm'], coordinator: coordinatorId });
    await markSlotsUnavailable(venue.id, { date, slots: ['am'], reason: 'Power outage' }, venueStaffId);

    await expect(
      markSlotsUnavailable(venue.id, { date, slots: ['am', 'pm'], reason: 'Ceiling repair' }, venueStaffId),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // Only the first save's notice, about AM. PM was neither saved nor told.
    expect(await noticesFor(eventId)).toEqual([expect.objectContaining({ slots: ['am'], reason: 'Power outage' })]);
  });
});

describe("the coordinator's outstanding action (SCRUM-151 AC3)", () => {
  /** Stand-in D-12: removing the booking row by hand is how a tester "releases" it. */
  async function releaseByHand(venueId: string, eventId: string) {
    const { error } = await admin.from('venue_booking').delete().eq('venue_id', venueId).eq('event_request_id', eventId);
    if (error) throw new Error(`could not release test booking: ${error.message}`);
  }

  it('lists an affected booking with its venue, date, and each withdrawn slot with its reason', async () => {
    const venue = await createTestVenue('Hall N');
    const date = daysFromToday(12);
    const eventId = await bookEvent(venue.id, { date, slots: ['am', 'pm'], coordinator: coordinatorId });
    await markSlotsUnavailable(venue.id, { date, slots: ['pm'], reason: 'Power outage' }, venueStaffId);
    await markSlotsUnavailable(venue.id, { date, slots: ['am'], reason: 'Ceiling repair' }, venueStaffId);

    const affected = await listAffectedBookings(eventId);

    expect(affected).toEqual([
      expect.objectContaining({
        venueId: venue.id,
        venueName: venue.name,
        date,
        slots: [
          { slot: 'am', reason: 'Ceiling repair' },
          { slot: 'pm', reason: 'Power outage' },
        ],
      }),
    ]);
  });

  it('keeps listing it until the booking is released, then stops', async () => {
    const venue = await createTestVenue('Hall O');
    const date = daysFromToday(12);
    const eventId = await bookEvent(venue.id, { date, slots: ['am'], coordinator: coordinatorId });
    await markSlotsUnavailable(venue.id, { date, slots: ['am'], reason: 'Ceiling repair' }, venueStaffId);
    expect(await listAffectedBookings(eventId)).toHaveLength(1);

    await releaseByHand(venue.id, eventId);

    expect(await listAffectedBookings(eventId)).toEqual([]);
  });

  it('keeps listing it until the booking is replaced: a new booking elsewhere, then the old one released', async () => {
    const venue = await createTestVenue('Hall P');
    const replacement = await createTestVenue('Hall Q');
    const date = daysFromToday(12);
    const eventId = await bookEvent(venue.id, { date, slots: ['am'], coordinator: coordinatorId });
    await markSlotsUnavailable(venue.id, { date, slots: ['am'], reason: 'Ceiling repair' }, venueStaffId);

    // The replacement alone does not clear it: the old booking is still held.
    const { error } = await admin.from('venue_booking').insert({ venue_id: replacement.id, event_request_id: eventId });
    if (error) throw new Error(`could not book the replacement: ${error.message}`);
    expect((await listAffectedBookings(eventId)).map((booking) => booking.venueId)).toEqual([venue.id]);

    await releaseByHand(venue.id, eventId);

    // The old booking is gone, and the new one is not on an unavailable slot.
    expect(await listAffectedBookings(eventId)).toEqual([]);
  });

  it('does not list a booking of an event that has already happened', async () => {
    const venue = await createTestVenue('Hall R');
    const yesterday = daysFromToday(-1);
    const eventId = await bookEvent(venue.id, { date: yesterday, slots: ['am'], coordinator: coordinatorId });
    await markSlotsUnavailable(venue.id, { date: yesterday, slots: ['am'], reason: 'Late record' }, venueStaffId);

    expect(await listAffectedBookings(eventId)).toEqual([]);
  });

  it('lists nothing when none of the event\'s slots was withdrawn', async () => {
    const venue = await createTestVenue('Hall S');
    const date = daysFromToday(12);
    const eventId = await bookEvent(venue.id, { date, slots: ['pm'], coordinator: coordinatorId });
    await markSlotsUnavailable(venue.id, { date, slots: ['am'], reason: 'Ceiling repair' }, venueStaffId);

    expect(await listAffectedBookings(eventId)).toEqual([]);
  });
});

describe('listUpcomingUnavailableSlots: the venue page list (SCRUM-151 AC1)', () => {
  it('lists today and later only, soonest first, and AM before PM within a day', async () => {
    const venue = await createTestVenue('Hall G');
    await markSlotsUnavailable(venue.id, { date: daysFromToday(-1), slots: ['am'], reason: 'Yesterday' }, venueStaffId);
    await markSlotsUnavailable(venue.id, { date: daysFromToday(3), slots: ['pm', 'am'], reason: 'Later' }, venueStaffId);
    await markSlotsUnavailable(venue.id, { date: daysFromToday(1), slots: ['pm'], reason: 'Sooner' }, venueStaffId);

    const listed = await listUpcomingUnavailableSlots(venue.id);
    expect(listed.map(({ date, slot }) => `${date} ${slot}`)).toEqual([
      `${daysFromToday(1)} pm`,
      `${daysFromToday(3)} am`,
      `${daysFromToday(3)} pm`,
    ]);
  });
});
