import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createVenue } from '@/domain/venues/service';
import { createVenueHold, sendHoldExpiryNotifications } from '@/domain/venue-hold/service';
import { formatExpiry } from '@/domain/venue-hold/policy';
import { decideVenueBookingRequest } from '@/domain/venue-booking/service';
import { formatSingaporeDate, todayInSingapore } from '@/domain/shared/dates';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-228 Tell the coordinator when a hold is about to expire, against the
 * local Supabase stack.
 *
 * AC text is from the Jira card (authoritative):
 *   AC1 "Given my event has an active hold, when it is 24 hours from expiry,
 *        then I receive a notification naming the venue, date, slots and
 *        expiry time." (start and end time since the 15-minute unit, #126)
 *   AC2 "Given a hold on my event expires without an approved booking, when
 *        the expiry passes, then I receive a notification that the hold has
 *        lapsed."
 *   AC3 "Given the hold became a confirmed booking before it expired, when the
 *        expiry time passes, then no notification is sent."
 *
 * The check is notify_hold_expiries, which pg_cron runs every 5 minutes; here
 * it is run directly, at a chosen moment, through sendHoldExpiryNotifications.
 * pg_cron may also run during the tests, at the real time. Each hold is only
 * ever told once of each, so the assertions count notifications, not runs.
 *
 * Holds use slot-shaped times (AM is 07:00-12:00) where a booking has to close
 * them, because SCRUM-148's approval still writes slots until SCRUM-239.
 *
 * Test case IDs are from Joshua's Sprint 3 sheet (TC-228-nn).
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';
const HOUR = 3_600_000;

let locationId: string;
let venueStaffId: string;
let coordinatorA: string;
let coordinatorB: string;
let organiserId: string;
const venueIds: string[] = [];
const eventIds: string[] = [];

function daysFromToday(days: number): string {
  const date = new Date(`${todayInSingapore()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A Singapore date-time `hours` from now, as the hold form sends it. */
function singaporeInHours(hours: number): string {
  return new Date(Date.now() + hours * HOUR + 8 * HOUR).toISOString().slice(0, 16);
}

const DATE = daysFromToday(40);

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+holdexpiry${RUN}@connectsphere.example.com`,
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

/** An approved event assigned to `coordinator` (or to nobody). */
async function createApprovedEvent(coordinator: string | null = coordinatorA): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({ organiser_id: organiserId, client_organisation_id: CLIENT_ORGANISATION_ID, name: `Hold Expiry Event ${RUN}` })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test event: ${error?.message}`);
  eventIds.push(data.id);
  await admin.from('event_request').update({ status: 'submitted' }).eq('id', data.id);
  if (coordinator) {
    await admin.from('event_request').update({ coordinator_id: coordinator, assigned_by: coordinator }).eq('id', data.id);
  }
  const { error: approveError } = await admin
    .from('event_request')
    .update({ status: 'approved', decision: 'approved', decided_by: venueStaffId })
    .eq('id', data.id);
  if (approveError) throw new Error(`could not approve test event: ${approveError.message}`);
  return data.id;
}

/** An active AM hold (07:00-12:00) for the event, expiring `hoursAway` from now. */
async function holdAm(venueId: string, eventId: string, hoursAway: number) {
  return createVenueHold(
    venueId,
    { eventRequestId: eventId, date: DATE, start: '07:00', end: '12:00', expiresAt: singaporeInHours(hoursAway) },
    venueStaffId,
  );
}

/** A pending AM request for the event, made as SCRUM-142's form makes one. */
async function requestAm(venueId: string, eventId: string): Promise<{ requestId: string; lineId: string }> {
  const { data: requestId, error } = await admin.rpc('create_venue_booking_request', {
    p_event_request_id: eventId,
    p_venue_id: venueId,
    p_requested_by: coordinatorA,
    p_lines: [{ date: DATE, time_slots: ['am'] }],
  });
  if (error || !requestId) throw new Error(`could not create test request: ${error?.message}`);
  const { data: line } = await admin.from('venue_booking_request_line').select('id').eq('request_id', requestId).single();
  return { requestId, lineId: line!.id };
}

/** The hold notifications sent about an event, to whom, and what they say. */
async function holdNotices(eventId: string) {
  const { data, error } = await admin
    .from('notifications')
    .select('recipient_id, type, message')
    .eq('event_request_id', eventId)
    .like('message', 'Your hold on%');
  if (error || !data) throw new Error(`could not read notifications: ${error?.message}`);
  return data;
}

const at = (iso: string, offsetHours: number) => new Date(Date.parse(iso) + offsetHours * HOUR);

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  const { data: location, error } = await admin.from('locations').insert({ name: `Hold Expiry Location ${RUN}` }).select('id').single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;
  venueStaffId = await createUser('venue-staff');
  coordinatorA = await createUser('coordinator-a');
  coordinatorB = await createUser('coordinator-b');
  organiserId = await createUser('organiser');
});

afterAll(async () => {
  // Events first: holds, requests, bookings and notifications go with them.
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of venueIds) await admin.from('venues').delete().eq('id', id);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
  for (const id of [venueStaffId, coordinatorA, coordinatorB, organiserId]) if (id) await admin.auth.admin.deleteUser(id);
});

describe('SCRUM-228 AC1: warned 24 hours before the hold expires', () => {
  it('TC-228-01 sends the coordinator one notification naming the venue, date, times and expiry', async () => {
    const venue = await createTestVenue('Expiry Warned');
    const eventA = await createApprovedEvent();
    const hold = await holdAm(venue.id, eventA, 72);

    await sendHoldExpiryNotifications(at(hold.expiresAt, -23.9));

    expect(await holdNotices(eventA)).toEqual([
      {
        recipient_id: coordinatorA,
        type: 'venue_booking_update',
        message: `Your hold on ${venue.name} for ${formatSingaporeDate(DATE)}, 07:00-12:00 expires at ${formatExpiry(hold.expiresAt)}. Finish the booking before then, or look for another venue.`,
      },
    ]);
  });

  it('TC-228-02 sends nothing while more than 24 hours remain', async () => {
    const venue = await createTestVenue('Expiry Not Yet');
    const eventA = await createApprovedEvent();
    const hold = await holdAm(venue.id, eventA, 72);

    await sendHoldExpiryNotifications(at(hold.expiresAt, -25));

    expect(await holdNotices(eventA)).toEqual([]);
  });

  it("TC-228-03 tells only the event's own coordinator", async () => {
    const venue = await createTestVenue('Expiry Own Coordinator');
    const eventA = await createApprovedEvent();
    const hold = await holdAm(venue.id, eventA, 72);

    await sendHoldExpiryNotifications(at(hold.expiresAt, -23.9));

    const recipients = (await holdNotices(eventA)).map((notice) => notice.recipient_id);
    expect(recipients).toEqual([coordinatorA]);
    expect(recipients).not.toContain(coordinatorB);
  });

  it('warns once, however often the check runs', async () => {
    const venue = await createTestVenue('Expiry Once');
    const eventA = await createApprovedEvent();
    const hold = await holdAm(venue.id, eventA, 72);

    await sendHoldExpiryNotifications(at(hold.expiresAt, -23.9));
    await sendHoldExpiryNotifications(at(hold.expiresAt, -20));
    await sendHoldExpiryNotifications(at(hold.expiresAt, -1));

    expect(await holdNotices(eventA)).toHaveLength(1);
  });

  it('TC-228-04 sends no warning once the hold was booked before the 24-hour mark', async () => {
    const venue = await createTestVenue('Expiry Booked Early');
    const eventA = await createApprovedEvent();
    const hold = await holdAm(venue.id, eventA, 30);
    const { requestId, lineId } = await requestAm(venue.id, eventA);
    await decideVenueBookingRequest(requestId, venueStaffId, { decisions: [{ lineId, decision: 'approve' }] });

    await sendHoldExpiryNotifications(at(hold.expiresAt, -23));

    expect(await holdNotices(eventA)).toEqual([]);
  });

  it('warns at the next run for a hold made with less than 24 hours left', async () => {
    const venue = await createTestVenue('Expiry Short Hold');
    const eventA = await createApprovedEvent();
    await holdAm(venue.id, eventA, 2);

    await sendHoldExpiryNotifications(new Date());

    expect((await holdNotices(eventA)).map((notice) => notice.message)).toEqual([expect.stringContaining('expires at')]);
  });

  it('tells nobody while the event has no coordinator', async () => {
    const venue = await createTestVenue('Expiry No Coordinator');
    const unassigned = await createApprovedEvent(null);
    const hold = await holdAm(venue.id, unassigned, 72);

    await sendHoldExpiryNotifications(at(hold.expiresAt, -23.9));

    expect(await holdNotices(unassigned)).toEqual([]);
  });
});

describe('SCRUM-228 AC2: told when the hold lapses without an approved booking', () => {
  it('TC-228-05 tells the coordinator the hold on the venue has lapsed', async () => {
    const venue = await createTestVenue('Expiry Lapsed');
    const eventA = await createApprovedEvent();
    const hold = await holdAm(venue.id, eventA, 72);

    await sendHoldExpiryNotifications(at(hold.expiresAt, 0.1));

    const lapse = (await holdNotices(eventA)).filter((notice) => notice.message.includes('lapsed'));
    expect(lapse).toEqual([
      {
        recipient_id: coordinatorA,
        type: 'venue_booking_update',
        message: `Your hold on ${venue.name} for ${formatSingaporeDate(DATE)}, 07:00-12:00 lapsed at ${formatExpiry(hold.expiresAt)} without a confirmed booking. The venue is no longer held for this event.`,
      },
    ]);
  });

  it('TC-228-06 still tells the coordinator when their request was pending, not approved', async () => {
    const venue = await createTestVenue('Expiry Pending Request');
    const eventA = await createApprovedEvent();
    const hold = await holdAm(venue.id, eventA, 72);
    await requestAm(venue.id, eventA);

    await sendHoldExpiryNotifications(at(hold.expiresAt, 0.1));

    expect((await holdNotices(eventA)).some((notice) => notice.message.includes('lapsed'))).toBe(true);
  });

  it('tells the coordinator of the lapse once, however often the check runs', async () => {
    const venue = await createTestVenue('Expiry Lapse Once');
    const eventA = await createApprovedEvent();
    const hold = await holdAm(venue.id, eventA, 72);

    await sendHoldExpiryNotifications(at(hold.expiresAt, 0.1));
    await sendHoldExpiryNotifications(at(hold.expiresAt, 5));

    expect((await holdNotices(eventA)).filter((notice) => notice.message.includes('lapsed'))).toHaveLength(1);
  });
});

describe('SCRUM-228 AC3: nothing is sent for a hold that became a booking', () => {
  it('TC-228-07 sends no lapse notification once the request was approved before the expiry', async () => {
    const venue = await createTestVenue('Expiry Became Booking');
    const eventA = await createApprovedEvent();
    const hold = await holdAm(venue.id, eventA, 72);
    const { requestId, lineId } = await requestAm(venue.id, eventA);
    await decideVenueBookingRequest(requestId, venueStaffId, { decisions: [{ lineId, decision: 'approve' }] });

    await sendHoldExpiryNotifications(at(hold.expiresAt, -23.9));
    await sendHoldExpiryNotifications(at(hold.expiresAt, 0.1));

    expect(await holdNotices(eventA)).toEqual([]);
  });
});
