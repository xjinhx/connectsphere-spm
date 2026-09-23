import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { listEventRequestsForOrganiser, type EventRequestRow } from '@/lib/supabase/eventRequests';

/**
 * SCRUM-70 — Access only my own client organisation's events. AC text is from
 * the Jira card (clarification #81), which is authoritative.
 *
 * AC1: the event list shows only events belonging to my own client
 * organisation. AC2 (denying direct access to another organisation's event
 * by id) is unit-tested against fixtures in
 * tests/unit/event-request-organisation-sharing.test.ts (canViewRequest,
 * SCRUM-204) — the same rule this story's AC2 depends on, already exercised
 * there for a cross-organisation request.
 *
 * This exercises the real SQL seam AC1 depends on -
 * listEventRequestsForOrganiser's `.or()` filter - against genuine Postgres
 * rows and two real client_organisations.
 *
 * Not covered here - verify manually through a signed-in session:
 * listMyEventRequests()/getEventRequest() end-to-end (getCurrentActor() is
 * not parameterised, so it cannot be driven from an integration test - see
 * DoD note on manual testing through a function/API with a signed-in
 * session).
 */

const supabase = createAdminClient();

const createdRequestIds: string[] = [];
const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function createOrganisation(name: string): Promise<string> {
  const { data, error } = await supabase
    .from('client_organisations')
    .insert({ name })
    .select('id')
    .single();
  if (error) throw new Error(`could not create test organisation: ${error.message}`);
  createdOrgIds.push(data.id as string);
  return data.id as string;
}

async function createOrganiser(): Promise<string> {
  const { data, error } = await supabase.auth.admin.createUser({
    email: `organiser+${Date.now()}-${Math.random().toString(36).slice(2)}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`could not create test organiser: ${error?.message ?? 'no user returned'}`);
  }
  createdUserIds.push(data.user.id);
  return data.user.id;
}

async function createEventRequest(
  organiserId: string,
  clientOrganisationId: string,
  status: 'draft' | 'submitted',
): Promise<string> {
  const { data, error } = await supabase
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: clientOrganisationId,
      name: `Test event ${Date.now()}-${Math.random().toString(36).slice(2)}`,
    })
    .select('id')
    .single();
  if (error) throw new Error(`could not create test request: ${error.message}`);

  const id = data.id as string;
  createdRequestIds.push(id);

  if (status === 'submitted') {
    const { error: submitError } = await supabase.from('event_request').update({ status: 'submitted' }).eq('id', id);
    if (submitError) throw new Error(`could not submit test request: ${submitError.message}`);
  }

  return id;
}

let orgA: string;
let orgB: string;
let organiserA1: string;
let organiserA2: string;
let organiserB1: string;

beforeAll(async () => {
  orgA = await createOrganisation(`Org A ${Date.now()}`);
  orgB = await createOrganisation(`Org B ${Date.now()}`);
  organiserA1 = await createOrganiser();
  organiserA2 = await createOrganiser();
  organiserB1 = await createOrganiser();
});

afterAll(async () => {
  for (const id of createdRequestIds) {
    await supabase.from('event_request').delete().eq('id', id);
  }
  for (const id of createdUserIds) {
    await supabase.auth.admin.deleteUser(id);
  }
  for (const id of createdOrgIds) {
    await supabase.from('client_organisations').delete().eq('id', id);
  }
});

describe('listEventRequestsForOrganiser (real client organisations)', () => {
  // AC1 — a colleague in the same, real client organisation sees a submitted request.
  it('includes a colleague-in-org-A submitted request for another org-A organiser', async () => {
    const submitted = await createEventRequest(organiserA1, orgA, 'submitted');

    const { data, error } = await listEventRequestsForOrganiser(supabase, organiserA2, orgA);
    if (error) throw new Error(error.message);

    expect((data as unknown as EventRequestRow[] | null)?.map((r) => r.id)).toContain(submitted);
  });

  // SCRUM-83 AC3 — a draft in the same org stays private to its creator.
  it('excludes a colleague-in-org-A draft request for another org-A organiser', async () => {
    const draft = await createEventRequest(organiserA1, orgA, 'draft');

    const { data, error } = await listEventRequestsForOrganiser(supabase, organiserA2, orgA);
    if (error) throw new Error(error.message);

    expect((data as unknown as EventRequestRow[] | null)?.map((r) => r.id)).not.toContain(draft);
  });

  // AC1 — a submitted request belonging to a different real organisation is excluded.
  it('excludes an org-A submitted request for an org-B organiser', async () => {
    const submitted = await createEventRequest(organiserA1, orgA, 'submitted');

    const { data, error } = await listEventRequestsForOrganiser(supabase, organiserB1, orgB);
    if (error) throw new Error(error.message);

    expect((data as unknown as EventRequestRow[] | null)?.map((r) => r.id)).not.toContain(submitted);
  });

  // AC1 baseline - the creator always sees their own request, draft or submitted.
  it("always includes the creator's own requests regardless of status", async () => {
    const draft = await createEventRequest(organiserA1, orgA, 'draft');
    const submitted = await createEventRequest(organiserA1, orgA, 'submitted');

    const { data, error } = await listEventRequestsForOrganiser(supabase, organiserA1, orgA);
    if (error) throw new Error(error.message);

    const ids = (data as unknown as EventRequestRow[] | null)?.map((r) => r.id);
    expect(ids).toContain(draft);
    expect(ids).toContain(submitted);
  });
});
