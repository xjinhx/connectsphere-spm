import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createVenue } from '@/domain/venues/service';
import {
  getBookingRequestRequirements,
  getVenueBookingDecision,
  submitVenueBookingRequest,
} from '@/domain/venue-booking/service';
import { NotFoundError } from '@/domain/shared/errors';
import { ensureTestClientOrganisation, TEST_CLIENT_ORGANISATION_ID } from './fixtures/clientOrganisation';

/**
 * SCRUM-143 Include the requirements Venue Staff need, against Postgres.
 *
 * AC text is from the Jira card (AC3 removed in CL-05). Test case IDs match the
 * SCRUM-143 sheet of the Sprint 2 test case workbook (TC-143-NN). Runs against
 * the local Supabase stack. Requests are raised through SCRUM-142's real
 * submitVenueBookingRequest; the admin client only arranges rows. The page is
 * SCRUM-148's decision page: its requested dates and slots come from
 * getVenueBookingDecision, and SCRUM-143's details from
 * getBookingRequestRequirements.
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

let locationId: string;
let venueId: string;
let organiserId: string;
let coordinatorId: string;
const eventIds: string[] = [];

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+brr${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message}`);
  return data.user.id;
}

/** An approved event assigned to the test coordinator, with `fields` recorded on it. */
async function approvedEvent(name: string, fields: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await admin
    .from('event_request')
    .insert({ organiser_id: organiserId, client_organisation_id: TEST_CLIENT_ORGANISATION_ID, name: `${name} ${RUN}`, ...fields })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create test event: ${error?.message}`);
  const id = data.id as string;
  eventIds.push(id);
  for (const patch of [
    { status: 'submitted' },
    { coordinator_id: coordinatorId, assigned_by: coordinatorId },
    { status: 'approved', decision: 'approved', decided_by: coordinatorId },
  ]) {
    const { error: stepError } = await admin.from('event_request').update(patch).eq('id', id);
    if (stepError) throw new Error(`could not prepare test event: ${stepError.message}`);
  }
  return id;
}

async function requestFor(eventId: string, date: string, timeSlots: string[]) {
  return (await submitVenueBookingRequest(eventId, coordinatorId, { venueId, lines: [{ date, timeSlots }] })).id;
}

beforeAll(async () => {
  await ensureTestClientOrganisation(admin);
  const { data, error } = await admin.from('locations').insert({ name: `BRR Location ${RUN}` }).select('id').single();
  if (error || !data) throw new Error(`could not create test location: ${error?.message}`);
  locationId = data.id;
  venueId = (await createVenue({ name: `Marina Bay Ballroom ${RUN}`, locationId, maxCapacity: 300 })).id;
  organiserId = await createUser('organiser');
  coordinatorId = await createUser('coordinator');
  const { error: nameError } = await admin.from('profiles').update({ full_name: 'Casey Tan' }).eq('id', coordinatorId);
  if (nameError) throw new Error(`could not name test coordinator: ${nameError.message}`);
});

afterAll(async () => {
  if (eventIds.length > 0) await admin.from('event_request').delete().in('id', eventIds);
  if (venueId) await admin.from('venues').delete().eq('id', venueId);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
  for (const id of [organiserId, coordinatorId]) {
    if (id) await admin.auth.admin.deleteUser(id);
  }
});

describe('SCRUM-143 AC1 — reference, requested dates and slots, requesting coordinator', () => {
  it('TC-143-01: shows the event reference, each requested date with its slots, and Casey Tan', async () => {
    const eventId = await approvedEvent('Annual Partner Gala');
    const requestId = await requestFor(eventId, '2026-10-20', ['pm', 'night']);

    const requirements = await getBookingRequestRequirements(requestId);
    const decision = await getVenueBookingDecision(requestId);

    const { data: event } = await admin.from('event_request').select('reference').eq('id', eventId).single();
    expect(requirements.eventReference).toBe(event?.reference);
    expect(requirements.eventName).toBe(`Annual Partner Gala ${RUN}`);
    expect(requirements.requestedByName).toBe('Casey Tan');
    expect(decision.lines).toEqual([expect.objectContaining({ date: '2026-10-20', timeSlots: ['pm', 'night'], status: 'pending' })]);
  });

  it('reports an unknown or malformed request id as not found', async () => {
    await expect(getBookingRequestRequirements('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(NotFoundError);
    await expect(getBookingRequestRequirements('not-a-uuid')).rejects.toBeInstanceOf(NotFoundError);
  });
});
