import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createEquipmentItem } from '@/domain/equipment/service';
import { addEquipmentLine } from '@/domain/equipment-request/service';
import { reserveEquipment } from '@/domain/equipment-reservation/service';
import { REGISTRATION_NOT_SET } from '@/domain/essential-arrangements/policy';
import type { EssentialArrangementsInput } from '@/domain/essential-arrangements/schema';
import { getEssentialArrangements, recordEssentialArrangements } from '@/domain/essential-arrangements/service';
import { NO_ACCESS_MESSAGE } from '@/domain/event-record/policy';
import { getEventRecord } from '@/domain/event-record/service';
import type { Role } from '@/domain/identity/roles';
import { updateRegistrationSettings } from '@/domain/registration-list/service';
import { ForbiddenError } from '@/domain/shared/errors';
import { todayInSingapore } from '@/domain/shared/dates';
import { decideVenueBookingRequest } from '@/domain/venue-booking/service';
import { createVenue } from '@/domain/venues/service';
import { ensureTestClientOrganisation, TEST_CLIENT_ORGANISATION_ID } from './fixtures/clientOrganisation';

/**
 * SCRUM-109 View the full event record (Jira, authoritative):
 *   AC1 Given I open an event I am permitted to view, when the page loads, then
 *       event details, status, assigned coordinator, venue arrangement,
 *       equipment arrangement and registration setting are shown in one place.
 *   AC2 Given a section contains information my role may not see, when the
 *       page loads, then that section is omitted rather than shown empty.
 *   AC3 Given I am the Event Coordinator Lead, when I open any active event,
 *       then I can view its status and which arrangements are marked
 *       essential, with whether each is complete, and no action to change them
 *       is offered.
 *
 * Runs against the local Supabase stack. Every arrangement is made through the
 * service of the story that owns it (a booking approved by Venue Staff,
 * equipment requested by the coordinator and reserved by Technical Support,
 * registration set by the coordinator), so the record reads them as the app
 * records them. The rules on their own, and the page, are in
 * tests/unit/event-record.test.tsx. Test case IDs match the SCRUM-109 tab of
 * the Sprint 4 sheet.
 */

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const OTHER_ORGANISATION_ID = '66666666-6666-4666-8666-666666666666';

type Account = { userId: string; roles: Role[]; clientOrganisation: { id: string } | null };

const accountIds: string[] = [];
const eventIds: string[] = [];
const equipmentIds: string[] = [];
const venueIds: string[] = [];
let locationId: string;
let venueId: string;
let projectorId: string;

let organiser: Account;
let colleague: Account;
let otherOrganiser: Account;
let coordinator: Account;
let otherCoordinator: Account;
let lead: Account;
let venueStaff: Account;
let technicalSupport: Account;

let galaId: string;
let newApprovalId: string;
let leadReviewId: string;
let cancelledId: string;

const TODAY = todayInSingapore();

function daysFromToday(days: number): string {
  const date = new Date(`${TODAY}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createAccount(label: string, roles: Role[], clientOrganisationId: string | null = null): Promise<Account> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label.toLowerCase().replace(/\s+/g, '-')}+record${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  accountIds.push(data.user.id);
  const { error: profileError } = await admin
    .from('profiles')
    .update({ roles, full_name: label, client_organisation_id: clientOrganisationId })
    .eq('id', data.user.id);
  if (profileError) throw new Error(`could not set up profile for ${label}: ${profileError.message}`);
  return { userId: data.user.id, roles, clientOrganisation: clientOrganisationId ? { id: clientOrganisationId } : null };
}

/** The organiser's event, submitted, assigned to the coordinator and Approved. */
async function approvedEvent(name: string, date: string): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({
      organiser_id: organiser.userId,
      client_organisation_id: TEST_CLIENT_ORGANISATION_ID,
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
    { coordinator_id: coordinator.userId, assigned_by: lead.userId },
    { status: 'approved', decision: 'approved', decided_by: coordinator.userId },
  ]) {
    const { error: stepError } = await admin.from('event_request').update(patch).eq('id', data.id);
    if (stepError) throw new Error(`could not prepare test event: ${stepError.message}`);
  }
  return data.id;
}

/** A booking at the venue on `date`, requested by the coordinator and approved by Venue Staff (Approved → Planning). */
async function bookVenue(eventId: string, date: string): Promise<void> {
  const { data: requestId, error } = await admin.rpc('create_venue_booking_request', {
    p_event_request_id: eventId,
    p_venue_id: venueId,
    p_requested_by: coordinator.userId,
    p_lines: [{ date, start: '10:00', end: '12:00' }],
  });
  if (error || !requestId) throw new Error(`could not request test booking: ${error?.message}`);
  const { data: line } = await admin.from('venue_booking_request_line').select('id').eq('request_id', requestId).single();
  await decideVenueBookingRequest(requestId as string, venueStaff.userId, { decisions: [{ lineId: line!.id, decision: 'approve' }] });
}

async function markEssential(eventId: string, set: Partial<EssentialArrangementsInput>): Promise<void> {
  await recordEssentialArrangements(eventId, coordinator.userId, {
    venue: 'not_required',
    equipment: 'not_required',
    technicalSupport: 'not_required',
    registration: 'not_required',
    ...set,
  });
}

async function setStatus(eventId: string, status: string): Promise<void> {
  const { error } = await admin.from('event_request').update({ status }).eq('id', eventId);
  if (error) throw new Error(`could not move test event: ${error.message}`);
}

async function expectForbidden(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ForbiddenError);
  expect((error as Error).message).toBe(NO_ACCESS_MESSAGE);
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  await admin.from('client_organisations').upsert({ id: OTHER_ORGANISATION_ID, name: `Lion City Conferences ${RUN}` });
  const { data: location, error } = await admin.from('locations').insert({ name: `S109 Location ${RUN}` }).select('id').single();
  if (error || !location) throw new Error(`could not create test location: ${error?.message}`);
  locationId = location.id;

  organiser = await createAccount('Organiser', ['event_organiser'], TEST_CLIENT_ORGANISATION_ID);
  colleague = await createAccount('Organiser Colleague', ['event_organiser'], TEST_CLIENT_ORGANISATION_ID);
  otherOrganiser = await createAccount('Organiser Other', ['event_organiser'], OTHER_ORGANISATION_ID);
  coordinator = await createAccount('Coordinator', ['coordinator']);
  otherCoordinator = await createAccount('Coordinator B', ['coordinator']);
  lead = await createAccount('Lead', ['operations_manager']);
  venueStaff = await createAccount('Venue Staff', ['venue_staff']);
  technicalSupport = await createAccount('Tech Support', ['technical_support']);

  const venue = await createVenue({ name: `S109 Marina Bay Ballroom ${RUN}`, locationId, maxCapacity: 300 });
  venueIds.push(venue.id);
  venueId = venue.id;
  const projector = await createEquipmentItem(
    { name: `S109 Projector P-100 ${RUN}`, category: 'av', quantity: 10, currentLocation: 'Bugis store room' },
    technicalSupport.userId,
  );
  equipmentIds.push(projector.id);
  projectorId = projector.id;

  // AC1/AC2: Confirmed, booked, Projector P-100 × 2 reserved, registration
  // set, internal notes recorded, all four arrangements essential.
  const galaDate = daysFromToday(40);
  galaId = await approvedEvent('S109 Harbour Gala', galaDate);
  await bookVenue(galaId, galaDate);
  const { line } = await addEquipmentLine(galaId, coordinator.userId, { equipmentId: projectorId, quantity: 2 });
  await reserveEquipment(galaId, line.id, technicalSupport.userId, { quantity: 2 });
  await markEssential(galaId, { venue: 'essential', equipment: 'essential', technicalSupport: 'essential', registration: 'essential' });
  await admin.from('event_request').update({ internal_notes: 'VIP table near stage' }).eq('id', galaId);
  await setStatus(galaId, 'confirmed');
  await updateRegistrationSettings(galaId, coordinator.userId, { startDate: TODAY, endDate: daysFromToday(14), capacity: 250 });

  // AC1 TC-109-03, AC2 TC-109-10: Approved, nothing arranged yet. Its
  // technical requirements are saved but no item is added, so its equipment
  // request is not yet raised (SCRUM-160 AC10).
  newApprovalId = await approvedEvent('S109 New Approval', daysFromToday(45));
  await admin.from('equipment_request').upsert({ event_request_id: newApprovalId, technical_requirements: 'Lectern mic' });

  // AC3 TC-109-14: a finished event the Lead opens as history (PO, 1 Nov).
  cancelledId = await approvedEvent('S109 Cancelled Talk', daysFromToday(55));
  await setStatus(cancelledId, 'cancelled');

  // AC3: Planning, booked, Projector P-100 × 2 not reserved, registration not set.
  const reviewDate = daysFromToday(50);
  leadReviewId = await approvedEvent('S109 Lead Review', reviewDate);
  await bookVenue(leadReviewId, reviewDate);
  await addEquipmentLine(leadReviewId, coordinator.userId, { equipmentId: projectorId, quantity: 2 });
  await markEssential(leadReviewId, { venue: 'essential', equipment: 'essential', registration: 'essential' });
});

afterAll(async () => {
  // Events first: their bookings, lines and reservations go with them (cascade).
  for (const id of eventIds) await admin.from('event_request').delete().eq('id', id);
  for (const id of equipmentIds) await admin.from('equipment').delete().eq('id', id);
  for (const id of venueIds) await admin.from('venues').delete().eq('id', id);
  for (const id of accountIds) await admin.auth.admin.deleteUser(id);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
  await admin.from('client_organisations').delete().eq('id', OTHER_ORGANISATION_ID);
});

describe('SCRUM-109 AC1: everything in one place, for someone permitted to view it', () => {
  it('SCRUM-109 AC1 TC-109-01 the assigned coordinator: details, status, coordinator, venue, equipment and registration', async () => {
    const record = await getEventRecord(galaId, coordinator);

    expect(record.viewers).toEqual(['coordinator']);
    expect(record.details.name).toBe(`S109 Harbour Gala ${RUN}`);
    expect(record.status).toBe('confirmed');
    expect(record.coordinator).toMatchObject({ name: 'Coordinator', email: `coordinator+record${RUN}@connectsphere.example.com` });
    expect(record.venue?.bookings).toEqual([
      { venueName: `S109 Marina Bay Ballroom ${RUN}`, date: daysFromToday(40), startTime: '10:00', endTime: '12:00', status: 'confirmed' },
    ]);
    expect(record.venue?.requests.map((request) => request.status)).toEqual(['approved']);
    expect(record.equipment?.lines).toEqual([{ equipmentName: `S109 Projector P-100 ${RUN}`, quantity: 2, reserved: true }]);
    expect(record.registration).toEqual({ required: true, startDate: TODAY, endDate: daysFromToday(14), capacity: 250 });
    expect(record.internal?.internalNotes).toBe('VIP table near stage');
  });

  it('SCRUM-109 AC1 TC-109-02 the responsible organiser: the same sections, their coordinator with contact details', async () => {
    const record = await getEventRecord(galaId, organiser);

    expect(record.viewers).toEqual(['organiser']);
    expect(record.status).toBe('confirmed');
    expect(record.coordinator?.name).toBe('Coordinator');
    expect(record.coordinator?.email).toBe(`coordinator+record${RUN}@connectsphere.example.com`);
    expect(record.venue?.bookings).toHaveLength(1);
    expect(record.equipment?.lines).toHaveLength(1);
    expect(record.registration?.capacity).toBe(250);
  });

  it('SCRUM-109 AC1 TC-109-03 nothing arranged yet: each section is there and empty, not missing', async () => {
    const record = await getEventRecord(newApprovalId, coordinator);

    expect(record.status).toBe('approved');
    expect(record.venue).toEqual({ bookings: [], requests: [] });
    expect(record.equipment).toEqual({ status: null, lines: [] });
    expect(record.registration).toEqual({ required: true, startDate: null, endDate: null, capacity: null });
    expect(record.essential).toEqual([]);
  });

  it('SCRUM-109 AC1 TC-109-04 an organiser of another client organisation is refused', async () => {
    await expectForbidden(getEventRecord(galaId, otherOrganiser));
  });

  it('SCRUM-109 AC1 TC-109-05 a coordinator the event is not assigned to is refused', async () => {
    await expectForbidden(getEventRecord(galaId, otherCoordinator));
  });
});

describe('SCRUM-109 AC2: a section the role may not see is left out, not sent empty', () => {
  it('SCRUM-109 AC2 TC-109-06 Venue Staff: the coordinator by name and the venue arrangement, nothing else', async () => {
    const record = await getEventRecord(galaId, venueStaff);

    expect(record.viewers).toEqual(['venue_staff']);
    expect(record.coordinator).toEqual({ name: 'Coordinator', email: null, contactNumber: null });
    expect(record.venue?.bookings).toHaveLength(1);
    for (const section of ['internal', 'equipment', 'registration', 'essential']) expect(record).not.toHaveProperty(section);
  });

  it('SCRUM-109 AC2 TC-109-07 Technical Support: coordinator by name, venue and equipment, nothing else', async () => {
    const record = await getEventRecord(galaId, technicalSupport);

    expect(record.viewers).toEqual(['technical_support']);
    expect(record.coordinator?.email).toBeNull();
    expect(record.venue?.bookings).toHaveLength(1);
    expect(record.equipment?.lines).toHaveLength(1);
    for (const section of ['internal', 'registration', 'essential']) expect(record).not.toHaveProperty(section);
  });

  it('SCRUM-109 AC2 TC-109-08 the organiser: no internal notes and no essential set, anywhere in the record', async () => {
    const record = await getEventRecord(galaId, organiser);

    expect(record).not.toHaveProperty('internal');
    expect(record).not.toHaveProperty('essential');
    expect(JSON.stringify(record)).not.toContain('VIP table near stage');
  });

  it("SCRUM-109 AC2 TC-109-09 a colleague in the organiser's organisation: no coordinator section", async () => {
    const record = await getEventRecord(galaId, colleague);

    expect(record.viewers).toEqual(['colleague']);
    expect(record).not.toHaveProperty('coordinator');
    expect(record.venue?.bookings).toHaveLength(1);
    expect(record.equipment?.lines).toHaveLength(1);
    expect(record.registration?.capacity).toBe(250);
  });

  it('SCRUM-109 AC2 TC-109-10 Venue Staff and Technical Support are refused an event with no request for them (an equipment request with no item is not raised)', async () => {
    await expectForbidden(getEventRecord(newApprovalId, venueStaff));
    await expectForbidden(getEventRecord(newApprovalId, technicalSupport));
  });
});

describe('SCRUM-109 AC3: the Lead sees the status and the essential set, read-only', () => {
  it('SCRUM-109 AC3 TC-109-11 Planning: venue complete; equipment and registration not, with what is outstanding', async () => {
    const record = await getEventRecord(leadReviewId, lead);

    expect(record.viewers).toEqual(['lead']);
    expect(record.status).toBe('planning');
    expect(record.essential).toEqual([
      { arrangement: 'venue', progress: 'complete', outstanding: [] },
      {
        arrangement: 'equipment',
        progress: 'not_complete',
        outstanding: [`Equipment: S109 Projector P-100 ${RUN}, 2 still to reserve.`],
      },
      { arrangement: 'registration', progress: 'not_complete', outstanding: [REGISTRATION_NOT_SET] },
    ]);
  });

  it('SCRUM-109 AC3 TC-109-12 Confirmed: venue, equipment and registration complete; technical support not recorded', async () => {
    const record = await getEventRecord(galaId, lead);

    expect(record.status).toBe('confirmed');
    expect(record.essential?.map(({ arrangement, progress }) => [arrangement, progress])).toEqual([
      ['venue', 'complete'],
      ['equipment', 'complete'],
      ['technicalSupport', 'not_recorded'],
      ['registration', 'complete'],
    ]);
  });

  it('SCRUM-109 AC3 TC-109-14 the Lead opens a Cancelled event as history, read-only', async () => {
    const record = await getEventRecord(cancelledId, lead);

    expect(record.viewers).toEqual(['lead']);
    expect(record.status).toBe('cancelled');
  });

  it('SCRUM-109 AC3 TC-109-13 the Lead cannot change the essential set; it stays as it was', async () => {
    const before = await getEssentialArrangements(leadReviewId, coordinator.userId);

    const error = await recordEssentialArrangements(leadReviewId, lead.userId, {
      venue: 'not_required',
      equipment: 'not_required',
      technicalSupport: 'not_required',
      registration: 'not_required',
    }).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ForbiddenError);
    expect((await getEssentialArrangements(leadReviewId, coordinator.userId)).needs).toEqual(before.needs);
    // And the view the Lead is given offers no change (SCRUM-100's canChange).
    expect((await getEssentialArrangements(leadReviewId, lead.userId)).canChange).toBe(false);
  });
});
