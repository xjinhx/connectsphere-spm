import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { assignCoordinator } from '@/domain/assignment/service';
import { createEquipmentItem } from '@/domain/equipment/service';
import { addEquipmentLine } from '@/domain/equipment-request/service';
import { changeEventStatus } from '@/domain/event-status/service';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import type { Role } from '@/domain/identity/roles';
import { approveEventRequest } from '@/domain/review/service';
import {
  getLatestSafetyCheck,
  getSafetyCheckView,
  listEventsAwaitingSafetyCheck,
  recordSafetyCheckDecision,
} from '@/domain/safety-check/service';
import { ConflictError, ForbiddenError, InvalidTransitionError, ValidationError } from '@/domain/shared/errors';
import { decideVenueBookingRequest } from '@/domain/venue-booking/service';
import { createVenue } from '@/domain/venues/service';
import { ensureTestClientOrganisation, TEST_CLIENT_ORGANISATION_ID } from './fixtures/clientOrganisation';

/**
 * SCRUM-234 Run the Operational Safety Check, against the local Supabase stack
 * (`npm run db:start`, then the migrations applied).
 *
 * The rules on their own are in tests/unit/safety-check.test.ts. What only a
 * real database can show is here: that a decision and the event's new status
 * land together, and that a refusal leaves both exactly as they were.
 *
 * AC text is from the Jira card (authoritative), as updated by Change Log
 * CL-27 (18 Oct):
 *   AC1 "Given an account holds the Safety Officer role, when that user logs
 *        in, then they land on a list of Confirmed events awaiting a safety
 *        check."
 *   AC2 "Given I open an event awaiting a check, when the page loads, then its
 *        expected attendance, the venue's capacity for the requested layout,
 *        the accessibility answer with its features and notes, and the
 *        requested equipment are shown."
 *   AC3 "Given I approve the event, when I save, then my decision, name and
 *        time are recorded and the event moves to Preparation."
 *   AC4 "Given I reject the safety arrangement or request changes, when I
 *        save with a reason, then my decision, the reason, my name and the
 *        time are recorded, the event returns to Planning, and its assigned
 *        coordinator sees the reason." (Customer clarification #130: not
 *        Cancelled; it is revised and resubmitted.)
 *   AC5 "Given an event has not been approved by the Safety Officer, when
 *        anyone tries to move it to Preparation, then the move is refused and
 *        the status is unchanged."
 *   AC6 "Given a user without the Safety Officer role, when they try to record
 *        a safety decision, then it is refused."
 *
 * Test case IDs are from the SCRUM-234 tab of Team_Owned_ScrumsTest.xlsx
 * (TC-234-nn).
 */

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

type Account = { userId: string; roles: Role[] };

const accountIds: string[] = [];
const eventIds: string[] = [];
const equipmentIds: string[] = [];
const venueIds: string[] = [];
let locationId: string;

let manager: Account;
let organiser: Account;
let coordinator: Account;
let otherCoordinator: Account;
let venueStaff: Account;
let technicalSupport: Account;
let safetyOfficer: Account;

let venueId: string;
let projector: string;
// Each event books its own day, so no two overlap at the shared venue.
let nextDay = 1;

async function createAccount(label: string, roles: Role[]): Promise<Account> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+safety${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  accountIds.push(data.user.id);
  const { error: profileError } = await admin.from('profiles').update({ roles, full_name: label }).eq('id', data.user.id);
  if (profileError) throw new Error(`could not set up profile for ${label}: ${profileError.message}`);
  return { userId: data.user.id, roles };
}

/**
 * An event brought to Planning the way the app gets it there - submitted,
 * assigned, approved, then a venue booking request that Venue Staff approve
 * (SCRUM-101's trigger moves it to Planning) - with `withDetails` adding the
 * attendance, layout, accessibility and equipment AC2 shows.
 */
async function createPlanningEvent(withDetails = true): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiser.userId,
      client_organisation_id: TEST_CLIENT_ORGANISATION_ID,
      name: `Harbour Gala ${RUN}`,
      proposed_date: `2027-03-${String(nextDay).padStart(2, '0')}`,
      start_time: '10:00',
      end_time: '12:00',
      ...(withDetails
        ? {
            expected_attendance: 80,
            room_layout: 'theatre',
            accessibility_required: true,
            accessibility_notes: 'Step-free access',
          }
        : {}),
    })
    .select('id, proposed_date')
    .single();
  if (error) throw new Error(`could not create test event: ${error.message}`);
  const id = data.id as string;
  eventIds.push(id);
  nextDay += 1;

  await admin.from('event_request').update({ status: 'submitted' }).eq('id', id);
  await assignCoordinator(id, { coordinatorId: coordinator.userId, actorId: manager.userId });
  await approveEventRequest(id, { actorId: coordinator.userId });

  if (withDetails) {
    await addEquipmentLine(id, coordinator.userId, { equipmentId: projector, quantity: 2 });
  }

  const { data: requestId, error: requestError } = await admin.rpc('create_venue_booking_request', {
    p_event_request_id: id,
    p_venue_id: venueId,
    p_requested_by: coordinator.userId,
    p_lines: [{ date: data.proposed_date, start: '10:00', end: '12:00' }],
  });
  if (requestError || !requestId) throw new Error(`could not request test booking: ${requestError?.message}`);
  const { data: line } = await admin.from('venue_booking_request_line').select('id').eq('request_id', requestId).single();
  await decideVenueBookingRequest(requestId as string, venueStaff.userId, {
    decisions: [{ lineId: line!.id, decision: 'approve' }],
  });
  return id;
}

async function createConfirmedEvent(withDetails = true): Promise<string> {
  const id = await createPlanningEvent(withDetails);
  await changeEventStatus(id, 'confirmed');
  return id;
}

async function storedStatus(eventId: string): Promise<EventRequestStatus> {
  const { data, error } = await admin.from('event_request').select('status').eq('id', eventId).single();
  if (error) throw new Error(`could not read test event: ${error.message}`);
  return data.status as EventRequestStatus;
}

async function storedChecks(eventId: string) {
  const { data, error } = await admin
    .from('safety_check')
    .select('decision, note, decided_by, decided_at')
    .eq('event_request_id', eventId)
    .order('decided_at');
  if (error) throw new Error(`could not read test checks: ${error.message}`);
  return data ?? [];
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  manager = await createAccount('manager', ['operations_manager']);
  organiser = await createAccount('organiser', ['event_organiser']);
  coordinator = await createAccount('coordinator', ['coordinator']);
  otherCoordinator = await createAccount('othercoordinator', ['coordinator']);
  venueStaff = await createAccount('venuestaff', ['venue_staff']);
  technicalSupport = await createAccount('techsupport', ['technical_support']);
  safetyOfficer = await createAccount('safetyofficer', ['safety_officer']);

  const { data: location, error } = await admin.from('locations').insert({ name: `Safety Location ${RUN}` }).select('id').single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;
  const venue = await createVenue({
    name: `Bugis Seminar Room ${RUN}`,
    locationId,
    maxCapacity: 200,
    layouts: [
      { layout: 'theatre', capacity: 120 },
      { layout: 'banquet', capacity: 90 },
    ],
  });
  venueId = venue.id;
  venueIds.push(venue.id);

  const item = await createEquipmentItem(
    { name: `Projector ${RUN}`, category: 'av', quantity: 10, currentLocation: 'Bugis store room' },
    technicalSupport.userId,
  );
  projector = item.id;
  equipmentIds.push(item.id);
});

afterAll(async () => {
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of equipmentIds) await admin.from('equipment').delete().eq('id', id);
  for (const id of venueIds) await admin.from('venues').delete().eq('id', id);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
  for (const id of accountIds) await admin.auth.admin.deleteUser(id);
});

describe('AC1 — the list of Confirmed events awaiting a check', () => {
  it('TC-234-01/02: lists a Confirmed event with its venue, and not a Planning one', async () => {
    const confirmed = await createConfirmedEvent();
    const planning = await createPlanningEvent();

    const list = await listEventsAwaitingSafetyCheck(safetyOfficer);
    const listed = list.find((item) => item.id === confirmed);
    expect(listed).toMatchObject({ name: `Harbour Gala ${RUN}`, venues: [`Bugis Seminar Room ${RUN}`] });
    expect(list.some((item) => item.id === planning)).toBe(false);
  });

  it('TC-234-18: the list is refused for anyone without the role', async () => {
    for (const account of [coordinator, manager, venueStaff]) {
      await expect(listEventsAwaitingSafetyCheck(account)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe('AC2 — the check page', () => {
  it('TC-234-05: shows attendance, venue capacity and layout, accessibility and equipment', async () => {
    const id = await createConfirmedEvent();
    const view = await getSafetyCheckView(id, safetyOfficer);

    expect(view.expectedAttendance).toBe('80');
    expect(view.roomLayout).toBe('Theatre');
    expect(view.accessibility).toContain('Step-free access');
    expect(view.venues).toHaveLength(1);
    expect(view.venues[0]).toMatchObject({
      venueName: `Bugis Seminar Room ${RUN}`,
      maxCapacity: 200,
      layoutCapacity: 120,
      layout: { description: 'Theatre', fromEvent: true },
      expectedAttendance: { description: '80', fromEvent: true },
    });
    expect(view.equipment).toEqual([{ name: `Projector ${RUN}`, quantity: 2 }]);
    expect(view.awaitingCheck).toBe(true);
  });

  it('TC-234-06: anything never recorded reads "Not specified"', async () => {
    const id = await createConfirmedEvent(false);
    const view = await getSafetyCheckView(id, safetyOfficer);

    expect(view.expectedAttendance).toBe('Not specified');
    expect(view.accessibility).toBe('Not specified');
    expect(view.equipment).toEqual([]);
    // The venue's own capacity is still shown.
    expect(view.venues[0]).toMatchObject({ maxCapacity: 200, layoutCapacity: null });
  });

  it('TC-234-18: the check page is refused for anyone without the role', async () => {
    const id = await createConfirmedEvent();
    await expect(getSafetyCheckView(id, coordinator)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('AC3 — approve', () => {
  it('TC-234-08: records the decision, the Safety Officer and the time, and moves the event to Preparation', async () => {
    const id = await createConfirmedEvent();
    const before = Date.now();

    const outcome = await recordSafetyCheckDecision(id, { decision: 'approved' }, safetyOfficer);

    expect(outcome.status).toBe('preparation');
    expect(outcome.check).toMatchObject({ decision: 'approved', note: null, decidedByName: 'safetyofficer' });
    expect(await storedStatus(id)).toBe('preparation');
    const [check] = await storedChecks(id);
    expect(check).toMatchObject({ decision: 'approved', note: null, decided_by: safetyOfficer.userId });
    expect(new Date(check!.decided_at).getTime()).toBeGreaterThanOrEqual(before - 5_000);

    // It leaves the list.
    const list = await listEventsAwaitingSafetyCheck(safetyOfficer);
    expect(list.some((item) => item.id === id)).toBe(false);
  });

  it('TC-234-09: a decision on an event that is not Confirmed is refused and nothing is recorded', async () => {
    const id = await createPlanningEvent();
    await expect(recordSafetyCheckDecision(id, { decision: 'approved' }, safetyOfficer)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await storedStatus(id)).toBe('planning');
    expect(await storedChecks(id)).toEqual([]);
  });
});

describe('AC4 — request changes, with a reason', () => {
  it('TC-234-10: records the decision, reason, name and time, returns the event to Planning, and the assigned coordinator sees the reason', async () => {
    const id = await createConfirmedEvent();
    const note = 'Add a second fire marshal for 150 guests';

    const outcome = await recordSafetyCheckDecision(id, { decision: 'changes_requested', note }, safetyOfficer);

    expect(outcome.status).toBe('planning');
    expect(await storedStatus(id)).toBe('planning');
    expect(await getLatestSafetyCheck(id, coordinator)).toMatchObject({ decision: 'changes_requested', note });
  });

  it('a coordinator the event is not assigned to cannot read the reason', async () => {
    const id = await createConfirmedEvent();
    await recordSafetyCheckDecision(id, { decision: 'changes_requested', note: 'Widen the aisle' }, safetyOfficer);
    await expect(getLatestSafetyCheck(id, otherCoordinator)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('AC4 — reject the safety arrangement, with a reason', () => {
  it('TC-234-11: records the reason and returns the event to Planning, not Cancelled', async () => {
    const id = await createConfirmedEvent();
    const reason = 'Evacuation route blocked by stage layout';

    await recordSafetyCheckDecision(id, { decision: 'rejected', note: reason }, safetyOfficer);

    expect(await storedStatus(id)).toBe('planning');
    expect(await storedChecks(id)).toMatchObject([{ decision: 'rejected', note: reason }]);
    expect(await getLatestSafetyCheck(id, coordinator)).toMatchObject({ decision: 'rejected', note: reason });
  });

  it('TC-234-04: revised and confirmed again, it is listed again with the earlier check kept', async () => {
    const id = await createConfirmedEvent();
    await recordSafetyCheckDecision(id, { decision: 'rejected', note: 'Exit blocked' }, safetyOfficer);
    await changeEventStatus(id, 'confirmed');

    const list = await listEventsAwaitingSafetyCheck(safetyOfficer);
    expect(list.some((item) => item.id === id)).toBe(true);
    const view = await getSafetyCheckView(id, safetyOfficer);
    expect(view.awaitingCheck).toBe(true);
    expect(view.checks).toMatchObject([{ decision: 'rejected', note: 'Exit blocked' }]);
  });
});

describe('AC4 — a reason is required for both', () => {
  it('TC-234-12: a blank reason or one of only spaces is refused and nothing changes', async () => {
    const id = await createConfirmedEvent();
    await expect(
      recordSafetyCheckDecision(id, { decision: 'changes_requested', note: '' }, safetyOfficer),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      recordSafetyCheckDecision(id, { decision: 'rejected', note: '   ' }, safetyOfficer),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await storedStatus(id)).toBe('confirmed');
    expect(await storedChecks(id)).toEqual([]);
  });

  it('the database refuses a blank reason too, and the status change goes with it', async () => {
    const id = await createConfirmedEvent();
    const { error } = await admin.rpc('record_safety_check', {
      p_event_request_id: id,
      p_decision: 'rejected',
      p_note: '  ',
      p_decided_by: safetyOfficer.userId,
    });
    expect(error).not.toBeNull();
    expect(await storedStatus(id)).toBe('confirmed');
    expect(await storedChecks(id)).toEqual([]);
  });
});

describe('AC5 — no move to Preparation without the Safety Officer', () => {
  it('TC-234-13/14: a plain status change to Preparation is refused and the event stays Confirmed', async () => {
    const id = await createConfirmedEvent();
    await expect(changeEventStatus(id, 'preparation')).rejects.toBeInstanceOf(InvalidTransitionError);
    expect(await storedStatus(id)).toBe('confirmed');
  });

  it('TC-234-15: after approval, Preparation -> Completed and Preparation -> Cancelled are allowed', async () => {
    const toComplete = await createConfirmedEvent();
    const toCancel = await createConfirmedEvent();
    await recordSafetyCheckDecision(toComplete, { decision: 'approved' }, safetyOfficer);
    await recordSafetyCheckDecision(toCancel, { decision: 'approved' }, safetyOfficer);

    await changeEventStatus(toComplete, 'completed');
    await changeEventStatus(toCancel, 'cancelled');
    expect(await storedStatus(toComplete)).toBe('completed');
    expect(await storedStatus(toCancel)).toBe('cancelled');
  });
});

describe('AC6 — only the Safety Officer decides', () => {
  it('TC-234-16: every other role is refused and nothing is recorded', async () => {
    const id = await createConfirmedEvent();
    for (const account of [coordinator, manager, venueStaff, organiser]) {
      for (const input of [
        { decision: 'approved' },
        { decision: 'changes_requested', note: 'x' },
        { decision: 'rejected', note: 'x' },
      ]) {
        await expect(recordSafetyCheckDecision(id, input, account)).rejects.toBeInstanceOf(ForbiddenError);
      }
    }
    expect(await storedStatus(id)).toBe('confirmed');
    expect(await storedChecks(id)).toEqual([]);
  });
});
