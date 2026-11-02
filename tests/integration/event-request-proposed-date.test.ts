import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { ValidationError } from '@/domain/shared/errors';
import { ensureTestClientOrganisation, TEST_CLIENT_ORGANISATION_ID } from './fixtures/clientOrganisation';

/**
 * SCRUM-76 — the proposed date's year, against the local Supabase stack
 * (TC-76-10 to TC-76-12).
 *
 * AC4 (Jira): "Given a proposed date is in the future, when the Organiser
 * submits, then the request can be created - no minimum lead time applies."
 *
 * The defect: the date was checked with z.coerce.date(), which accepts a
 * five-digit year. The service then wrote "+020266-12" to Postgres, which
 * refused it with a raw "time zone displacement out of range" error, so the
 * organiser saw a 400 "could not be saved" instead of a message on the date
 * field. Whether a date is accepted is decided by Postgres as much as by the
 * schema, so it is shown here through createEventRequest() and
 * saveEventRequestDraft() and the stored row, not through the schema alone
 * (tests/unit/event-request-basic-details.test.ts has the schema on its own).
 *
 * getCurrentActor is mocked because both saves read the signed-in session and
 * there is no browser here, the same pattern as
 * submit-event-request-notifications.test.ts. The mock is the session, not the
 * code under test.
 */

const actor = vi.hoisted(() => ({ current: null as { userId: string } | null }));

vi.mock('@/lib/auth/currentActor', () => ({
  getCurrentActor: async () => {
    if (!actor.current) throw new Error('no actor set for this test');
    return {
      userId: actor.current.userId,
      fullName: 'Proposed Date Organiser',
      roles: ['event_organiser'],
      clientOrganisation: { id: '22222222-2222-2222-2222-222222222222', name: 'Integration Test Organisation' },
    };
  },
}));

const { createEventRequest, saveEventRequestDraft } = await import('@/domain/event-request/service');

const supabase = createAdminClient();
const CHOOSE_A_VALID_DATE = 'Choose a valid date.';

let organiserId: string;
const createdRequestIds: string[] = [];

const basicDetails = {
  name: 'Annual Tech Summit',
  purpose: 'Networking',
  description: 'Yearly gathering',
};

async function storedDates(): Promise<string[]> {
  const { data, error } = await supabase
    .from('event_request')
    .select('proposed_date')
    .eq('organiser_id', organiserId);
  if (error) throw new Error(`could not read the stored requests: ${error.message}`);
  return (data ?? []).map((row) => row.proposed_date as string);
}

async function refusal(attempt: Promise<unknown>): Promise<ValidationError> {
  try {
    await attempt;
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error as ValidationError;
  }
  throw new Error('expected the save to be refused, but it succeeded');
}

beforeAll(async () => {
  await ensureTestClientOrganisation(supabase);
  const { data, error } = await supabase.auth.admin.createUser({
    email: `proposed-date+${Date.now()}${Math.random().toString(36).slice(2, 8)}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
    user_metadata: { full_name: 'Proposed Date Organiser' },
  });
  if (error || !data.user) throw new Error(`could not create the test organiser: ${error?.message}`);
  organiserId = data.user.id;
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ roles: ['event_organiser'], full_name: 'Proposed Date Organiser' })
    .eq('id', organiserId);
  if (profileError) throw new Error(`could not set the organiser's role: ${profileError.message}`);
  actor.current = { userId: organiserId };
});

afterAll(async () => {
  await supabase.from('event_request').delete().eq('organiser_id', organiserId);
  for (const id of createdRequestIds) {
    await supabase.from('event_request').delete().eq('id', id);
  }
  await supabase.auth.admin.deleteUser(organiserId);
});

describe('SCRUM-76 TC-76-10: a four-digit-year date is saved and read back unchanged', () => {
  it('stores 10 Dec 2026 on a saved request', async () => {
    const saved = await createEventRequest({ ...basicDetails, proposedDate: '2026-12-10' });
    createdRequestIds.push(saved.id);

    const { data } = await supabase.from('event_request').select('proposed_date').eq('id', saved.id).single();
    expect(data?.proposed_date).toBe('2026-12-10');
    expect(saved.proposedDate).toBe('2026-12-10');
    expect(saved.clientOrganisationId).toBe(TEST_CLIENT_ORGANISATION_ID);
  });

  it('stores 10 Dec 2026 on a draft', async () => {
    const saved = await saveEventRequestDraft({ name: 'Draft summit', proposedDate: '2026-12-10' });
    createdRequestIds.push(saved.id);

    const { data } = await supabase.from('event_request').select('proposed_date').eq('id', saved.id).single();
    expect(data?.proposed_date).toBe('2026-12-10');
  });
});

describe('SCRUM-76 TC-76-11: a five-digit year is refused on the field and nothing is stored', () => {
  it('refuses the request with the message on proposedDate, not a raw database error', async () => {
    const before = await storedDates();

    const error = await refusal(createEventRequest({ ...basicDetails, proposedDate: '20266-12-10' }));

    expect(error.message).toBe('The event request is not valid.');
    expect(error.details).toMatchObject({ fieldErrors: { proposedDate: [CHOOSE_A_VALID_DATE] } });
    expect(JSON.stringify(error.details)).not.toContain('time zone displacement');
    expect(await storedDates()).toEqual(before);
  });

  it('refuses the draft the same way', async () => {
    const before = await storedDates();

    const error = await refusal(saveEventRequestDraft({ name: 'Draft summit', proposedDate: '20266-12-10' }));

    expect(error.message).toBe('The draft could not be saved.');
    expect(error.details).toMatchObject({ fieldErrors: { proposedDate: [CHOOSE_A_VALID_DATE] } });
    expect(JSON.stringify(error.details)).not.toContain('time zone displacement');
    expect(await storedDates()).toEqual(before);
  });
});

describe('SCRUM-76 TC-76-12: 9999-12-31 is the last date accepted', () => {
  it('stores 31 Dec 9999 and refuses 1 Jan 10000', async () => {
    const saved = await createEventRequest({ ...basicDetails, proposedDate: '9999-12-31' });
    createdRequestIds.push(saved.id);
    const { data } = await supabase.from('event_request').select('proposed_date').eq('id', saved.id).single();
    expect(data?.proposed_date).toBe('9999-12-31');

    const before = await storedDates();
    const error = await refusal(createEventRequest({ ...basicDetails, proposedDate: '10000-01-01' }));
    expect(error.details).toMatchObject({ fieldErrors: { proposedDate: [CHOOSE_A_VALID_DATE] } });
    expect(await storedDates()).toEqual(before);
  });
});
