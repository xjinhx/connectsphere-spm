import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-191 — Reject a change request with a reason.
 *
 * AC text is from the Jira card (team proposal, no customer clarification
 * ref). Test case IDs match the sheet (SCRUM-191 tab).
 *
 * Runs against the local Supabase stack (`npm run db:start` + `npm run
 * db:reset`). A real database is the point: the Pending-only gate is
 * enforced by both rejectChangeRequest and a real update filtered on
 * status='pending' (rejectChangeRequestRow), which an in-memory mock cannot
 * prove; and decided_at is stamped by the change_request_set_decided_at
 * trigger (20261027093000_change_request_reject.sql), not supplied by the
 * caller, which only a real database enforces.
 *
 * getCurrentActor is not used here (rejectChangeRequest takes the actor id
 * directly, unlike the route), so no mock is needed — same reasoning as
 * change-request.test.ts (SCRUM-187).
 */

const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

const supabase = createAdminClient();

const { raiseChangeRequest } = await import('@/domain/change-request/service');
const { rejectChangeRequest } = await import('@/domain/change-request/service');

let organiserId: string;
let coordinatorId: string;
let otherCoordinatorId: string;
const createdRequestIds: string[] = [];
const createdUserIds: string[] = [];

async function createAccount(label: string, roles: string[], clientOrganisationId: string | null = null): Promise<string> {
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
    .update({ roles, full_name: label, client_organisation_id: clientOrganisationId })
    .eq('id', data.user.id);
  if (profileError) throw new Error(`could not set roles for ${label}: ${profileError.message}`);
  createdUserIds.push(data.user.id);
  return data.user.id;
}

async function createEvent(status: string, coordinator: string | null = coordinatorId) {
  const { data, error } = await supabase
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: CLIENT_ORGANISATION_ID,
      name: 'Annual Tech Summit',
      purpose: 'Bring the engineering teams together for the yearly update.',
      description: 'A full day of talks, workshops and a closing reception.',
      proposed_date: '2027-03-15',
      start_time: '10:00',
      end_time: '12:00',
      expected_attendance: 150,
      status,
      submitted_at: status === 'draft' ? null : new Date().toISOString(),
      coordinator_id: coordinator,
      assigned_by: coordinator ? organiserId : null,
      assigned_at: coordinator ? new Date().toISOString() : null,
    })
    .select('id')
    .single();
  if (error) throw new Error(`could not create test event: ${error.message}`);
  const id = data.id as string;
  createdRequestIds.push(id);
  return id;
}

async function readChangeRequestRow(changeRequestId: string) {
  const { data, error } = await supabase
    .from('change_request')
    .select('id, status, decided_by, decided_at, decision_reason')
    .eq('id', changeRequestId)
    .single();
  if (error) throw new Error(`could not read change request: ${error.message}`);
  return data;
}

async function readEventExpectedAttendance(eventRequestId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('event_request')
    .select('expected_attendance')
    .eq('id', eventRequestId)
    .single();
  if (error) throw new Error(`could not read event: ${error.message}`);
  return data.expected_attendance as number | null;
}

async function readNotifications(recipientId: string, eventRequestId: string) {
  const { data, error } = await supabase
    .from('notifications')
    .select('type, message')
    .eq('recipient_id', recipientId)
    .eq('event_request_id', eventRequestId);
  if (error) throw new Error(`could not read notifications: ${error.message}`);
  return data;
}

beforeAll(async () => {
  await ensureTestClientOrganisation(supabase);
  organiserId = await createAccount('Olivia Organiser', ['event_organiser'], CLIENT_ORGANISATION_ID);
  coordinatorId = await createAccount('Casey Coordinator', ['coordinator']);
  otherCoordinatorId = await createAccount('Noah Not-Assigned', ['coordinator']);
});

afterAll(async () => {
  for (const id of createdRequestIds) {
    await supabase.from('event_request').delete().eq('id', id);
  }
  for (const id of createdUserIds) {
    await supabase.auth.admin.deleteUser(id);
  }
});

describe('rejectChangeRequest', () => {
  // TC-191-01 (AC1) — rejecting a Pending CR with a reason.
  it('sets a Pending change request to Rejected and stores the reason', async () => {
    const eventId = await createEvent('submitted');
    const raised = await raiseChangeRequest(
      eventId,
      { fields: [{ field: 'expectedAttendance', proposedValue: 180 }], reason: 'Extra guests confirmed' },
      organiserId,
    );

    const outcome = await rejectChangeRequest(
      eventId,
      raised.id,
      coordinatorId,
      { reason: 'Venue unavailable on new date' },
    );

    expect(outcome.status).toBe('rejected');
    expect(outcome.decisionReason).toBe('Venue unavailable on new date');
    expect(outcome.decidedAt).not.toBeNull();

    const row = await readChangeRequestRow(raised.id);
    expect(row.status).toBe('rejected');
    expect(row.decision_reason).toBe('Venue unavailable on new date');
    expect(row.decided_by).toBe(coordinatorId);
    // decided_at stamped by the database trigger, not supplied by the caller.
    expect(row.decided_at).not.toBeNull();
  });

  // TC-191-02 (AC2) — the event's own values are untouched by a rejection.
  it("leaves the event's values untouched after rejection", async () => {
    const eventId = await createEvent('submitted');
    const raised = await raiseChangeRequest(
      eventId,
      { fields: [{ field: 'expectedAttendance', proposedValue: 180 }], reason: 'Extra guests confirmed' },
      organiserId,
    );

    await rejectChangeRequest(eventId, raised.id, coordinatorId, { reason: 'Venue unavailable on new date' });

    expect(await readEventExpectedAttendance(eventId)).toBe(150);
  });

  // TC-191-03 (AC3) — the organiser is notified with the recorded reason.
  it('notifies the organiser who raised the request, with the reason included', async () => {
    const eventId = await createEvent('submitted');
    const raised = await raiseChangeRequest(
      eventId,
      { fields: [{ field: 'expectedAttendance', proposedValue: 180 }], reason: 'Extra guests confirmed' },
      organiserId,
    );

    await rejectChangeRequest(eventId, raised.id, coordinatorId, { reason: 'Venue unavailable on new date' });

    const notifications = await readNotifications(organiserId, eventId);
    const rejection = notifications.find((n) => n.type === 'change_request_rejected');
    expect(rejection).toBeTruthy();
    expect(rejection?.message).toContain('Venue unavailable on new date');
  });

  // TC-191-04 (AC4) — no reason: blocked, and the CR stays Pending.
  it('refuses rejection with no reason, and leaves the CR Pending', async () => {
    const eventId = await createEvent('submitted');
    const raised = await raiseChangeRequest(
      eventId,
      { fields: [{ field: 'expectedAttendance', proposedValue: 180 }], reason: 'Extra guests confirmed' },
      organiserId,
    );

    await expect(
      rejectChangeRequest(eventId, raised.id, coordinatorId, { reason: '' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const row = await readChangeRequestRow(raised.id);
    expect(row.status).toBe('pending');
  });

  // TC-191-05 (Supp.) — a coordinator not assigned to the event is refused.
  it('refuses a coordinator who is not assigned to the event', async () => {
    const eventId = await createEvent('submitted');
    const raised = await raiseChangeRequest(
      eventId,
      { fields: [{ field: 'expectedAttendance', proposedValue: 180 }], reason: 'Extra guests confirmed' },
      organiserId,
    );

    await expect(
      rejectChangeRequest(eventId, raised.id, otherCoordinatorId, { reason: 'Not my event' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const row = await readChangeRequestRow(raised.id);
    expect(row.status).toBe('pending');
  });

  // Regression — an already-decided CR cannot be rejected again.
  it('refuses a change request that has already been decided', async () => {
    const eventId = await createEvent('submitted');
    const raised = await raiseChangeRequest(
      eventId,
      { fields: [{ field: 'expectedAttendance', proposedValue: 180 }], reason: 'Extra guests confirmed' },
      organiserId,
    );
    await rejectChangeRequest(eventId, raised.id, coordinatorId, { reason: 'First rejection' });

    await expect(
      rejectChangeRequest(eventId, raised.id, coordinatorId, { reason: 'Second attempt' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
