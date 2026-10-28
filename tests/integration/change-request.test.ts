import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-187 — Request a change and track its outcome.
 *
 * AC text is from the Jira card, which is authoritative. Test case IDs match
 * the sheet (SCRUM-187 tab).
 *
 * Runs against the local Supabase stack (`npm run db:start` + `npm run db:reset`).
 * A real database is the point: the one-reason-per-field write and the
 * event-visibility rule (canViewRequest) cannot be proven without Postgres.
 *
 * getCurrentActor is not used here (raiseChangeRequest/listChangeRequests take
 * the actor id/roles directly, unlike the route), so no mock is needed.
 *
 * Status scope (Submitted through Preparation) and field scope (the full
 * event-request field set) both per CL-61, the PO's 24 Oct 2026
 * clarification — see policy.ts and schema.ts.
 *
 * AC7 ("the event shows the new values") is not this service's concern: it
 * is the event's own stored fields, read through the existing event-request
 * reads, once SCRUM-190 applies an approval. Nothing here writes to them.
 */

const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

const supabase = createAdminClient();

const { raiseChangeRequest, listChangeRequests } = await import('@/domain/change-request/service');

let organiserId: string;
let colleagueId: string;
let otherOrganiserId: string;
let coordinatorId: string;
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

async function createEvent(status: string, ownerId = organiserId, coordinator: string | null = coordinatorId) {
  const { data, error } = await supabase
    .from('event_request')
    .insert({
      organiser_id: ownerId,
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
      // event_request_approved_has_decision: 'approved' always carries one.
      decision: status === 'approved' ? 'approved' : null,
      decided_by: status === 'approved' ? coordinator ?? ownerId : null,
      decided_at: status === 'approved' ? new Date().toISOString() : null,
      coordinator_id: coordinator,
      assigned_by: coordinator ? ownerId : null,
      assigned_at: coordinator ? new Date().toISOString() : null,
    })
    .select('id')
    .single();
  if (error) throw new Error(`could not create test event: ${error.message}`);
  const id = data.id as string;
  createdRequestIds.push(id);
  return id;
}

async function readChangeRequestRows(eventRequestId: string) {
  const { data, error } = await supabase
    .from('change_request')
    .select('id, status, reason, decided_at, decision_reason')
    .eq('event_request_id', eventRequestId);
  if (error) throw new Error(`could not read change requests: ${error.message}`);
  return data;
}

async function readFieldRows(changeRequestId: string) {
  const { data, error } = await supabase
    .from('change_request_field')
    .select('field, current_value, proposed_value')
    .eq('change_request_id', changeRequestId);
  if (error) throw new Error(`could not read change request fields: ${error.message}`);
  return data;
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

// DUMMY(SCRUM-190) D-26, DUMMY(SCRUM-191) D-26: stands in for SCRUM-190/191's
// own write. See docs/dummies.md.
async function seedDecision(changeRequestId: string, status: 'approved' | 'rejected', reason: string) {
  const { error } = await supabase
    .from('change_request')
    .update({ status, decided_at: new Date().toISOString(), decision_reason: reason })
    .eq('id', changeRequestId);
  if (error) throw new Error(`could not seed decision: ${error.message}`);
}

beforeAll(async () => {
  await ensureTestClientOrganisation(supabase);
  organiserId = await createAccount('Olivia Organiser', ['event_organiser'], CLIENT_ORGANISATION_ID);
  colleagueId = await createAccount('Cora Colleague', ['event_organiser'], CLIENT_ORGANISATION_ID);
  otherOrganiserId = await createAccount('Otto Other', ['event_organiser'], null);
  coordinatorId = await createAccount('Casey Coordinator', ['coordinator']);
});

afterAll(async () => {
  for (const id of createdRequestIds) {
    await supabase.from('event_request').delete().eq('id', id);
  }
  for (const id of createdUserIds) {
    await supabase.auth.admin.deleteUser(id);
  }
});

describe('raiseChangeRequest', () => {
  // TC-187-01 (AC1) — a Submitted event.
  it('creates a Pending request storing the current and proposed value, and notifies the coordinator', async () => {
    const id = await createEvent('submitted');

    const outcome = await raiseChangeRequest(
      id,
      { fields: [{ field: 'expectedAttendance', proposedValue: 180 }], reason: 'Extra guests confirmed' },
      organiserId,
    );

    expect(outcome.status).toBe('pending');
    expect(outcome.fields).toHaveLength(1);
    expect(outcome.fields[0]).toMatchObject({
      field: 'expectedAttendance',
      currentValue: 150,
      proposedValue: 180,
    });

    const rows = await readChangeRequestRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('pending');

    const fieldRows = await readFieldRows(outcome.id);
    expect(fieldRows).toHaveLength(1);
    expect(fieldRows[0]).toMatchObject({ field: 'expectedAttendance', current_value: 150, proposed_value: 180 });

    const notifications = await readNotifications(coordinatorId, id);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.type).toBe('change_requested');
  });

  // TC-187-02 (AC1) — a Confirmed event, the other status AC1 names literally.
  it('accepts a change request on a Confirmed event the same way', async () => {
    const id = await createEvent('confirmed');

    // Both ends of the pair, same as the sheet's test data (startTime/endTime) -
    // proposing just a start later than the event's current unchanged end
    // (12:00) would be an invalid range (see timeRangeIssues below).
    const outcome = await raiseChangeRequest(
      id,
      {
        fields: [
          { field: 'startTime', proposedValue: '14:00' },
          { field: 'endTime', proposedValue: '16:00' },
        ],
        reason: 'Programme running longer',
      },
      organiserId,
    );

    expect(outcome.status).toBe('pending');
  });

  // TC-187-15 (AC1) — CL-61 widens the status scope to Approved, Planning and
  // Preparation too (everything from Submitted to the event finishing).
  it.each(['approved', 'planning', 'preparation'] as const)(
    'accepts a change request on a(n) %s event too (CL-61)',
    async (status) => {
      const id = await createEvent(status);

      const outcome = await raiseChangeRequest(
        id,
        { fields: [{ field: 'expectedAttendance', proposedValue: 180 }], reason: 'Extra guests confirmed' },
        organiserId,
      );

      expect(outcome.status).toBe('pending');
    },
  );

  // TC-187-16 (AC1) — the full event-request field set per CL-61, not only
  // the SCRUM-111/190 "significant" subset: a plain text field (name) and a
  // boolean one (registrationRequired).
  it('accepts name and registrationRequired, the full event-request field set (CL-61)', async () => {
    const id = await createEvent('submitted');

    const outcome = await raiseChangeRequest(
      id,
      {
        fields: [
          { field: 'name', proposedValue: 'Annual Tech Summit 2.0' },
          { field: 'registrationRequired', proposedValue: true },
        ],
        reason: 'Rebranding and opening registration',
      },
      organiserId,
    );

    expect(outcome.fields.map((f) => f.field).sort()).toEqual(['name', 'registrationRequired']);
    expect(outcome.fields.find((f) => f.field === 'name')).toMatchObject({
      currentValue: 'Annual Tech Summit',
      proposedValue: 'Annual Tech Summit 2.0',
    });

    const fieldRows = await readFieldRows(outcome.id);
    expect(fieldRows).toHaveLength(2);
  });

  // TC-187-03 (AC1) — several fields, one reason, no extra field recorded.
  it('stores each selected field with its own current and proposed value under one reason', async () => {
    const id = await createEvent('submitted');

    const outcome = await raiseChangeRequest(
      id,
      {
        fields: [
          { field: 'expectedAttendance', proposedValue: 180 },
          { field: 'proposedDate', proposedValue: '2027-03-22' },
        ],
        reason: 'Venue and numbers both changing',
      },
      organiserId,
    );

    expect(outcome.reason).toBe('Venue and numbers both changing');
    expect(outcome.fields).toHaveLength(2);
    expect(outcome.fields.map((f) => f.field).sort()).toEqual(['expectedAttendance', 'proposedDate']);

    const fieldRows = await readFieldRows(outcome.id);
    expect(fieldRows).toHaveLength(2);
    expect(fieldRows.some((f) => f.field === 'description')).toBe(false);
  });

  // TC-187-04 (AC1) — no reason.
  it('refuses a request with no reason, and writes nothing', async () => {
    const id = await createEvent('submitted');

    await expect(
      raiseChangeRequest(id, { fields: [{ field: 'expectedAttendance', proposedValue: 180 }], reason: '' }, organiserId),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(await readChangeRequestRows(id)).toHaveLength(0);
  });

  // Bug found in review of PR #143 (28/10/2026): the form sends null for an
  // empty text, number, date or time field, and proposedValue: z.unknown()
  // passed it through. The change_request row was then created before the
  // field insert failed on the DB's proposed_value not null constraint,
  // leaving a Pending request with nothing asked. Refused before anything
  // is written (RaiseChangeRequestInputSchema), same as TC-187-04.
  it('refuses a missing proposed value, and writes nothing', async () => {
    const id = await createEvent('submitted');

    await expect(
      raiseChangeRequest(
        id,
        { fields: [{ field: 'description', proposedValue: null }], reason: 'Clearing the description' },
        organiserId,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(await readChangeRequestRows(id)).toHaveLength(0);
  });

  // Bug found manually testing TC-187-03 (28/10/2026): nothing checked that a
  // proposed start/end pair stays chronological, so Submitted had an end
  // before its start. Same rule as the event request's own save
  // (timeRangeIssues, domain/event-request/schema.ts).
  it('refuses a proposed end time before a proposed start time, and writes nothing', async () => {
    const id = await createEvent('submitted');

    await expect(
      raiseChangeRequest(
        id,
        {
          fields: [
            { field: 'startTime', proposedValue: '21:00' },
            { field: 'endTime', proposedValue: '19:00' },
          ],
          reason: 'Testing wrong timing',
        },
        organiserId,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(await readChangeRequestRows(id)).toHaveLength(0);
  });

  // Same bug, the one-sided case: only startTime selected, but it lands after
  // the event's current (unchanged) end time.
  it('refuses a proposed start time that is after the event\'s current end time', async () => {
    const id = await createEvent('submitted'); // start_time 10:00, end_time 12:00 (createEvent fixture)

    await expect(
      raiseChangeRequest(
        id,
        { fields: [{ field: 'startTime', proposedValue: '14:00' }], reason: 'Only changing the start' },
        organiserId,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(await readChangeRequestRows(id)).toHaveLength(0);
  });

  // TC-187-05 (AC2) — a Draft event.
  it('refuses a Draft event', async () => {
    const id = await createEvent('draft', organiserId, null);

    await expect(
      raiseChangeRequest(id, { fields: [{ field: 'expectedAttendance', proposedValue: 180 }], reason: 'Numbers changing' }, organiserId),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(await readChangeRequestRows(id)).toHaveLength(0);
  });

  // TC-187-07 (AC4) — a colleague in the same client organisation, not responsible.
  it('refuses a colleague who is not the responsible organiser', async () => {
    const id = await createEvent('submitted');

    await expect(
      raiseChangeRequest(id, { fields: [{ field: 'expectedAttendance', proposedValue: 180 }], reason: 'Not mine to change' }, colleagueId),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(await readChangeRequestRows(id)).toHaveLength(0);
  });

  // TC-187-08 (AC5) — Cancelled.
  it('refuses a Cancelled event', async () => {
    const id = await createEvent('cancelled');

    await expect(
      raiseChangeRequest(id, { fields: [{ field: 'expectedAttendance', proposedValue: 180 }], reason: 'Too late' }, organiserId),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  // TC-187-09 (AC5) — Completed.
  it('refuses a Completed event', async () => {
    const id = await createEvent('completed');

    await expect(
      raiseChangeRequest(id, { fields: [{ field: 'expectedAttendance', proposedValue: 180 }], reason: 'Too late' }, organiserId),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('listChangeRequests', () => {
  // TC-187-10 (AC6) — a Pending request, nothing decided yet.
  it('lists a Pending request with what was asked and no decision yet', async () => {
    const id = await createEvent('submitted');
    await raiseChangeRequest(id, { fields: [{ field: 'expectedAttendance', proposedValue: 180 }], reason: 'Extra guests confirmed' }, organiserId);

    const list = await listChangeRequests(id, { userId: organiserId, clientOrganisationId: CLIENT_ORGANISATION_ID });

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: 'pending', reason: 'Extra guests confirmed', decidedAt: null, decisionReason: null });
    expect(list[0]?.fields).toEqual([{ field: 'expectedAttendance', currentValue: 150, proposedValue: 180 }]);
  });

  // TC-187-11 (AC6) — a decided request (seeded directly, DUMMY(SCRUM-190)/(SCRUM-191)).
  it('lists a decided request with its status, decision date and reason', async () => {
    const id = await createEvent('submitted');
    const outcome = await raiseChangeRequest(
      id,
      { fields: [{ field: 'expectedAttendance', proposedValue: 220 }], reason: 'Extra guests confirmed' },
      organiserId,
    );
    await seedDecision(outcome.id, 'approved', 'Matches updated programme');

    const list = await listChangeRequests(id, { userId: organiserId, clientOrganisationId: CLIENT_ORGANISATION_ID });

    expect(list).toHaveLength(1);
    expect(list[0]?.status).toBe('approved');
    expect(list[0]?.decisionReason).toBe('Matches updated programme');
    expect(list[0]?.decidedAt).not.toBeNull();
  });

  // A colleague in the same client organisation may still view the event (SCRUM-204 AC3), so they can read the list too.
  it('allows a colleague in the same client organisation to read the list', async () => {
    const id = await createEvent('submitted');
    await raiseChangeRequest(id, { fields: [{ field: 'expectedAttendance', proposedValue: 180 }], reason: 'Extra guests confirmed' }, organiserId);

    const list = await listChangeRequests(id, { userId: colleagueId, clientOrganisationId: CLIENT_ORGANISATION_ID });
    expect(list).toHaveLength(1);
  });

  it('refuses an organiser outside the client organisation', async () => {
    const id = await createEvent('submitted');
    await raiseChangeRequest(id, { fields: [{ field: 'expectedAttendance', proposedValue: 180 }], reason: 'Extra guests confirmed' }, organiserId);

    await expect(
      listChangeRequests(id, { userId: otherOrganiserId, clientOrganisationId: null }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns an empty list for an event with none raised', async () => {
    const id = await createEvent('submitted');
    const list = await listChangeRequests(id, { userId: organiserId, clientOrganisationId: CLIENT_ORGANISATION_ID });
    expect(list).toEqual([]);
  });
});
