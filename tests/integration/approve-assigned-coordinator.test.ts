import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';
import { approveEventRequest } from '@/domain/review/service';
import { markEventRequestApproved } from '@/lib/supabase/eventRequests';

/**
 * SCRUM-213 — a coordinator reassigned away from an event can still approve it.
 *
 * Bug against SCRUM-92 (Approve a request so planning can proceed). The rule it
 * breaks is SCRUM-96 AC4, from the Jira card: "Given I have been reassigned away
 * from an event, when I request that event directly by its identifier, then
 * access is denied and no planning information is returned." Covered on the test
 * sheet by US-7.3-TC04, whose precondition is "Request assigned to a different
 * Coordinator".
 *
 * Runs against the local Supabase stack (`npm run db:start` + `npm run db:reset`).
 * A real database is the point: the second describe block below turns on the
 * conditional UPDATE refusing a row that was reassigned after the service
 * checked it, which nothing without Postgres can prove.
 *
 * The test uses the admin client to arrange rows - that is test setup, not the
 * code under test, which never holds a client (docs/architecture.md).
 */

const supabase = createAdminClient();

// SCRUM-203 put a foreign key on this column, so the row has to exist
// (ensureTestClientOrganisation, below).
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let organiserId: string;
let caseyId: string;
let weiId: string;
let unrelatedId: string;
let managerId: string;
const createdRequestIds: string[] = [];

async function createAccount(label: string, roles: string[]): Promise<string> {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const { data, error } = await supabase.auth.admin.createUser({
    email: `${slug}+${Date.now()}${Math.random().toString(36).slice(2, 8)}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
    user_metadata: { full_name: label },
  });
  if (error || !data.user) {
    throw new Error(`could not create test ${label}: ${error?.message ?? 'no user returned'}`);
  }
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ roles, full_name: label })
    .eq('id', data.user.id);
  if (profileError) throw new Error(`could not set roles for ${label}: ${profileError.message}`);
  return data.user.id;
}

/** A submitted request, optionally already assigned to a coordinator. */
async function createSubmittedRequest(coordinatorId: string | null = null): Promise<string> {
  const { data, error } = await supabase
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: CLIENT_ORGANISATION_ID,
      name: 'Annual Tech Summit',
    })
    .select('id')
    .single();
  if (error) throw new Error(`could not create test request: ${error.message}`);

  const id = data.id as string;
  createdRequestIds.push(id);

  const { error: submitError } = await supabase
    .from('event_request')
    .update({ status: 'submitted' })
    .eq('id', id);
  if (submitError) throw new Error(`could not submit test request: ${submitError.message}`);

  if (coordinatorId) await assign(id, coordinatorId);
  return id;
}

/** What SCRUM-94's assign and SCRUM-96's reassign do, arranged directly. */
async function assign(id: string, coordinatorId: string) {
  const { error } = await supabase
    .from('event_request')
    .update({ coordinator_id: coordinatorId, assigned_by: managerId })
    .eq('id', id);
  if (error) throw new Error(`could not assign: ${error.message}`);
}

async function readRow(id: string) {
  const { data, error } = await supabase
    .from('event_request')
    .select('status, decision, decided_by, decided_at, coordinator_id')
    .eq('id', id)
    .single();
  if (error) throw new Error(`could not read test request: ${error.message}`);
  return data;
}

beforeAll(async () => {
  // SCRUM-203's FK on client_organisation_id means CLIENT_ORGANISATION_ID
  // below must be a real row, not just a placeholder uuid.
  await ensureTestClientOrganisation(supabase);
  organiserId = await createAccount('Olivia Organiser', ['event_organiser']);
  caseyId = await createAccount('Casey Coordinator', ['coordinator']);
  weiId = await createAccount('Wei Coordinator', ['coordinator']);
  unrelatedId = await createAccount('Uma Coordinator', ['coordinator']);
  managerId = await createAccount('Morgan Manager', ['operations_manager']);
});

afterAll(async () => {
  // Requests first: coordinator_id, assigned_by and decided_by are ON DELETE
  // RESTRICT, so an account cannot go while a decision of theirs is recorded.
  for (const id of createdRequestIds) {
    await supabase.from('event_request').delete().eq('id', id);
  }
  for (const id of [organiserId, caseyId, weiId, unrelatedId, managerId]) {
    if (id) await supabase.auth.admin.deleteUser(id);
  }
});

describe('approveEventRequest — only a coordinator this event is not assigned away from', () => {
  // The bug, exactly as reported: assigned to Casey, reassigned to Wei, Casey
  // approves. Before the fix this returned 200 with decidedBy = Casey.
  it('refuses a coordinator the event has been reassigned away from', async () => {
    const id = await createSubmittedRequest(caseyId);
    await assign(id, weiId);

    await expect(approveEventRequest(id, { actorId: caseyId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    // "no planning information is returned" (SCRUM-96 AC4) — and nothing is
    // written either: the request is exactly as it was.
    const row = await readRow(id);
    expect(row.status).toBe('submitted');
    expect(row.decision).toBeNull();
    expect(row.decided_by).toBeNull();
    expect(row.decided_at).toBeNull();
    expect(row.coordinator_id).toBe(weiId);
  });

  it('allows the coordinator the event is now assigned to', async () => {
    const id = await createSubmittedRequest(caseyId);
    await assign(id, weiId);

    const outcome = await approveEventRequest(id, { actorId: weiId });

    expect(outcome.decision).toBe('approved');
    const row = await readRow(id);
    expect(row.status).toBe('approved');
    expect(row.decided_by).toBe(weiId);
  });

  it('refuses a coordinator who was never assigned the event', async () => {
    const id = await createSubmittedRequest(caseyId);

    await expect(approveEventRequest(id, { actorId: unrelatedId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect((await readRow(id)).status).toBe('submitted');
  });

  /**
   * Superseded 15 Oct 2026 by SCRUM-232 AC5 (Week 7 Customer Changes, change
   * 5, confirmed with Arwen on Slack): "Event Coordinators should only be
   * able to manage events assigned to them." Assignment through the Event
   * Coordinator Lead's queue is now a precondition of review, approval
   * included. This test used to record the opposite decision deliberately,
   * on the basis that neither SCRUM-92 AC1 nor US-7.3-TC04 covered the
   * unassigned case; change 5 now does.
   */
  it('refuses any coordinator to approve an event with no coordinator yet', async () => {
    const id = await createSubmittedRequest(null);

    await expect(approveEventRequest(id, { actorId: caseyId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect((await readRow(id)).status).toBe('submitted');
  });

  // SCRUM-232 AC5: a draft carries no coordinator_id - the database refuses
  // to assign one to a draft at all (event_request_assignment_needs_submission),
  // so this stays the unassigned case. canReviewDetail now refuses it before
  // canBeApproved is ever reached, same as every other decision action. No
  // existing-status leak: FORBIDDEN names nothing about the draft, where the
  // old INVALID_TRANSITION (confirming "cannot move from draft") did.
  it('refuses a draft, which has not been submitted for review', async () => {
    const id = await createSubmittedRequest(null);
    // submitted_at goes with the status: event_request_submitted_at_matches_status
    // refuses a draft that still carries a submission time.
    const { error } = await supabase
      .from('event_request')
      .update({ status: 'draft', submitted_at: null })
      .eq('id', id);
    if (error) throw new Error(`could not return the request to draft: ${error.message}`);

    await expect(approveEventRequest(id, { actorId: caseyId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('refuses a request that has already been approved', async () => {
    const id = await createSubmittedRequest(caseyId);
    await approveEventRequest(id, { actorId: caseyId });

    await expect(approveEventRequest(id, { actorId: caseyId })).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });
});

/**
 * The gap the service check on its own cannot close: an Event Operations Manager
 * reassigns the event between the service reading the row and the UPDATE landing.
 *
 * Tested against markEventRequestApproved directly, not through the service.
 * Racing the two from a test would be non-deterministic - whichever of the two
 * guards happened to win would make it pass - so it would prove nothing about
 * this filter in particular. Calling the query with a row it must refuse is the
 * same situation the race produces, arranged so it happens every time.
 */
describe('markEventRequestApproved — the guard inside the UPDATE (SCRUM-213)', () => {
  it('writes nothing when the event now belongs to another coordinator', async () => {
    const id = await createSubmittedRequest(weiId);

    const { data, error } = await markEventRequestApproved(id, caseyId);

    expect(error).toBeNull();
    expect(data).toBeNull(); // no row matched, so nothing was written
    const row = await readRow(id);
    expect(row.status).toBe('submitted');
    expect(row.decided_by).toBeNull();
  });

  it('writes when the event is the coordinator\'s own', async () => {
    const id = await createSubmittedRequest(caseyId);

    const { data } = await markEventRequestApproved(id, caseyId);

    expect(data).not.toBeNull();
    expect((await readRow(id)).decided_by).toBe(caseyId);
  });

  // SCRUM-232 AC5: no `is.null` branch in the filter any more - an event with
  // no coordinator yet can no longer be approved by anyone, Lead included
  // (the Lead never reaches this function, lacking event_request_approval).
  it('writes nothing when the event has no coordinator yet', async () => {
    const id = await createSubmittedRequest(null);

    const { data } = await markEventRequestApproved(id, caseyId);

    expect(data).toBeNull();
    const row = await readRow(id);
    expect(row.status).toBe('submitted');
    expect(row.decided_by).toBeNull();
  });

  it('still refuses a request that has already been decided', async () => {
    const id = await createSubmittedRequest(caseyId);
    await approveEventRequest(id, { actorId: caseyId });

    const { data } = await markEventRequestApproved(id, caseyId);

    expect(data).toBeNull(); // the status filter, unchanged by this fix
  });
});
