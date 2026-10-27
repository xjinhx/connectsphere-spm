import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { ForbiddenError, ValidationError } from '@/domain/shared/errors';
import { PAST_PROPOSED_DATE_MESSAGE } from '@/domain/event-request/policy';
import { todayInSingapore } from '@/domain/shared/dates';
import { ensureTestClientOrganisation, TEST_CLIENT_ORGANISATION_ID } from './fixtures/clientOrganisation';

/**
 * SCRUM-76 — Create an event request (TC-76-01 to TC-76-05 and TC-76-08), against
 * the local Supabase stack (`npm run db:start`, then the migrations applied).
 *
 * The rules on their own are in tests/unit/event-request-basic-details.test.ts,
 * event-request-submit.test.ts and event-request-times.test.ts. What only a real
 * database can show is here: that the values are stored and given a reference,
 * that a request lands in the organiser's own list, and that a refused save or
 * submission leaves the stored row exactly as it was.
 *
 * AC text is from the Jira card (authoritative):
 *   AC1 "Given the Organiser enters name, purpose, description, proposed date,
 *        and expected attendance, when the request is saved, then it is stored
 *        with those values and appears in the Organiser's event list."
 *   AC3 "Given a mandatory field ... is left empty, when the Organiser attempts
 *        to create the request, then the request is not created and the
 *        missing fields are identified."
 *   AC4 "Given a proposed date is in the future, when the Organiser submits,
 *        then the request can be created - no minimum lead time applies."
 *   AC5 "Given a proposed date earlier than today, when the Organiser attempts
 *        to submit, then submission is blocked, they are told the date must be
 *        today or later, and they can still save it as a draft."
 *   AC7 "Given a logged-in Organiser linked to a client organisation, when they
 *        choose to create an event request, then a blank request form opens
 *        with their client organisation pre-filled."
 * Not here: AC6 (today's date and the time of day) reads the real clock, so it
 * is the unit tests with a fixed `now` (event-request-times.test.ts, AC5); AC8
 * (an organiser with no organisation) is a page, covered in
 * tests/e2e/scrum-76-create-request.spec.ts.
 *
 * getCurrentActor is mocked because the services read the signed-in session and
 * there is no browser here, the same pattern as
 * submit-event-request-notifications.test.ts. The mock is the session, not the
 * code under test.
 */

const actor = vi.hoisted(() => ({
  current: null as { userId: string; roles: string[]; linked: boolean } | null,
}));

vi.mock('@/lib/auth/currentActor', () => ({
  getCurrentActor: async () => {
    if (!actor.current) throw new Error('no actor set for this test');
    return {
      userId: actor.current.userId,
      fullName: 'Create Request Actor',
      roles: actor.current.roles,
      clientOrganisation: actor.current.linked
        ? { id: '22222222-2222-2222-2222-222222222222', name: 'Integration Test Organisation' }
        : null,
    };
  },
}));

const { createEventRequest, getNewEventRequestContext, listMyEventRequests, saveEventRequestDraft, submitEventRequest } =
  await import('@/domain/event-request/service');

const supabase = createAdminClient();
const REFERENCE_PATTERN = /^EVT-\d{4}-\d{4,}$/;

const basicDetails = {
  name: 'Annual Tech Summit',
  purpose: 'Networking',
  description: 'Yearly gathering',
  proposedDate: '2026-11-15',
};
/** What submission also needs beyond the four basic details. */
const timesAndAttendance = { startTime: '09:00', endTime: '12:00', expectedAttendance: 80 };

let organiserId: string;
let coordinatorId: string;
const createdUserIds: string[] = [];

async function createAccount(label: string, roles: string[], clientOrganisationId: string | null): Promise<string> {
  const { data, error } = await supabase.auth.admin.createUser({
    email: `create-request-${label}+${Date.now()}${Math.random().toString(36).slice(2, 8)}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
    user_metadata: { full_name: label },
  });
  if (error || !data.user) throw new Error(`could not create the ${label} account: ${error?.message}`);
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ roles, full_name: label, client_organisation_id: clientOrganisationId })
    .eq('id', data.user.id);
  if (profileError) throw new Error(`could not set up the ${label} profile: ${profileError.message}`);
  createdUserIds.push(data.user.id);
  return data.user.id;
}

async function storedRows(userId: string) {
  const { data, error } = await supabase
    .from('event_request')
    .select('id, reference, name, purpose, description, proposed_date, status, client_organisation_id')
    .eq('organiser_id', userId);
  if (error) throw new Error(`could not read the stored requests: ${error.message}`);
  return data ?? [];
}

async function incompleteOf(attempt: Promise<unknown>) {
  try {
    await attempt;
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return (error as ValidationError).details as { incompleteFields: { field: string; label: string; reason: string }[] };
  }
  throw new Error('expected the submission to be refused, but it succeeded');
}

function daysFromToday(days: number): string {
  const date = new Date(`${todayInSingapore()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

beforeAll(async () => {
  await ensureTestClientOrganisation(supabase);
  organiserId = await createAccount('organiser', ['event_organiser'], TEST_CLIENT_ORGANISATION_ID);
  coordinatorId = await createAccount('coordinator', ['coordinator'], null);
  actor.current = { userId: organiserId, roles: ['event_organiser'], linked: true };
});

afterAll(async () => {
  for (const id of createdUserIds) {
    await supabase.from('event_request').delete().eq('organiser_id', id);
    await supabase.auth.admin.deleteUser(id);
  }
});

describe('SCRUM-76 TC-76-01 (AC7): only an Event Organiser can create an event request', () => {
  it.each([
    ['an Event Coordinator', ['coordinator']],
    ['an Attendee', ['attendee']],
    ['an account with no role', []],
  ])('refuses %s, on the form, on save and on draft, and stores nothing', async (_label, roles) => {
    actor.current = { userId: coordinatorId, roles, linked: false };

    await expect(getNewEventRequestContext()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createEventRequest({ ...basicDetails })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveEventRequestDraft({ name: 'Annual Tech Summit' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createEventRequest({ ...basicDetails })).rejects.toMatchObject({
      message: 'Only an Event Organiser can create an event request.',
    });

    expect(await storedRows(coordinatorId)).toEqual([]);
  });
});

describe('SCRUM-76 TC-76-02 (AC7): a linked Organiser starts with their client organisation', () => {
  it('hands the form the Organiser\'s own organisation, and a saved request carries it', async () => {
    actor.current = { userId: organiserId, roles: ['event_organiser'], linked: true };

    const context = await getNewEventRequestContext();
    expect(context.clientOrganisation).toEqual({
      id: TEST_CLIENT_ORGANISATION_ID,
      name: 'Integration Test Organisation',
    });

    const saved = await saveEventRequestDraft({ name: 'Organisation check' });
    const [row] = await storedRows(organiserId).then((rows) => rows.filter((candidate) => candidate.id === saved.id));
    expect(row?.client_organisation_id).toBe(TEST_CLIENT_ORGANISATION_ID);
  });
});

describe('SCRUM-76 TC-76-03 (AC1): a saved request keeps its details, gets a reference and is listed', () => {
  it('stores name, purpose, description and proposed date, and shows it in the Organiser\'s list', async () => {
    actor.current = { userId: organiserId, roles: ['event_organiser'], linked: true };

    const saved = await createEventRequest({ ...basicDetails, ...timesAndAttendance });

    const row = (await storedRows(organiserId)).find((candidate) => candidate.id === saved.id);
    expect(row).toMatchObject({
      name: 'Annual Tech Summit',
      purpose: 'Networking',
      description: 'Yearly gathering',
      proposed_date: '2026-11-15',
    });
    expect(row?.reference).toMatch(REFERENCE_PATTERN);
    expect((await listMyEventRequests()).map((request) => request.id)).toContain(saved.id);
  });
});

describe('SCRUM-76 TC-76-04 (AC3): a missing mandatory field blocks submission; a draft can still be saved', () => {
  it('saves the draft with the purpose blank, then refuses to submit it and names Purpose', async () => {
    actor.current = { userId: organiserId, roles: ['event_organiser'], linked: true };

    const draft = await saveEventRequestDraft({ ...basicDetails, ...timesAndAttendance, purpose: '' });
    expect(draft.status).toBe('draft');

    const incomplete = await incompleteOf(submitEventRequest(draft.id));
    expect(incomplete.incompleteFields.map((entry) => entry.label)).toEqual(['Purpose']);

    const row = (await storedRows(organiserId)).find((candidate) => candidate.id === draft.id);
    expect(row?.status).toBe('draft');
  });

  it('refuses a full save with the purpose blank, naming the field, and stores nothing', async () => {
    actor.current = { userId: organiserId, roles: ['event_organiser'], linked: true };
    const before = (await storedRows(organiserId)).length;

    await expect(createEventRequest({ ...basicDetails, purpose: '' })).rejects.toMatchObject({
      details: { fieldErrors: { purpose: ['Purpose is required'] } },
    });
    expect((await storedRows(organiserId)).length).toBe(before);
  });
});

describe('SCRUM-76 TC-76-05 (AC5): a proposed date earlier than today blocks submission; the draft is kept', () => {
  it('saves a request dated 1 Jan 2025 as a draft, refuses to submit it with the date message', async () => {
    actor.current = { userId: organiserId, roles: ['event_organiser'], linked: true };

    const draft = await saveEventRequestDraft({ ...basicDetails, ...timesAndAttendance, proposedDate: '2025-01-01' });
    expect(draft.status).toBe('draft');

    const incomplete = await incompleteOf(submitEventRequest(draft.id));
    expect(incomplete.incompleteFields).toEqual([
      { field: 'proposedDate', label: 'Proposed date', reason: PAST_PROPOSED_DATE_MESSAGE },
    ]);

    const row = (await storedRows(organiserId)).find((candidate) => candidate.id === draft.id);
    expect(row).toMatchObject({ status: 'draft', proposed_date: '2025-01-01' });
  });
});

describe('SCRUM-76 TC-76-08 (AC4): a future date is accepted, with no minimum lead time', () => {
  it.each([
    ['one week from today', 7],
    ['tomorrow', 1],
  ])('submits a complete request dated %s', async (_label, days) => {
    actor.current = { userId: organiserId, roles: ['event_organiser'], linked: true };

    const saved = await createEventRequest({ ...basicDetails, ...timesAndAttendance, proposedDate: daysFromToday(days) });
    const submitted = await submitEventRequest(saved.id);

    expect(submitted.status).toBe('submitted');
    const row = (await storedRows(organiserId)).find((candidate) => candidate.id === saved.id);
    expect(row).toMatchObject({ status: 'submitted', proposed_date: daysFromToday(days) });
  });
});
