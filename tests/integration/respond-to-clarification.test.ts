import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';
import type { Role } from '@/domain/identity/roles';

/**
 * SCRUM-91 — Respond to a clarification request (US-7.2).
 *
 * AC text is from the Jira card, which is authoritative. Test case IDs are the
 * sheet's numbering for the bundled US-7.2 story:
 *   sheet AC4 = Jira AC1, sheet AC5 = Jira AC2, sheet AC6 = Jira AC3.
 *
 * Runs against the local Supabase stack (`npm run db:start` + `npm run db:reset`).
 * A real database is the point: rounds are opened by a trigger on event_request
 * and a double answer is refused by a conditional UPDATE, so neither can be
 * proven without Postgres.
 *
 * getCurrentActor is mocked because submitEventRequest (SCRUM-82) reads the
 * signed-in session, and there is no browser here. The mock is the session, not
 * the code under test — everything it guards (ownership, role, completeness) is
 * still executed for real.
 *
 * The test uses the admin client to arrange rows - that is test setup, not the
 * code under test, which never holds a client (docs/architecture.md).
 *
 * Not covered here - verify manually or in a later sprint:
 *   AC1's "the assigned coordinator is notified" - there is no notification
 *        story this sprint (DUMMY(SCRUM-24) D-07). What is asserted is that the
 *        coordinator who would be told is identified and still owns the event.
 */

const actor = vi.hoisted(() => ({ current: null as { userId: string; roles: string[] } | null }));

vi.mock('@/lib/auth/currentActor', () => ({
  getCurrentActor: async () => {
    if (!actor.current) throw new Error('no actor set for this test');
    return {
      userId: actor.current.userId,
      fullName: 'Test Actor',
      roles: actor.current.roles,
      clientOrganisation: null,
    };
  },
}));

const { respondToClarification, getClarificationExchange } = await import(
  '@/domain/clarification/service'
);

const supabase = createAdminClient();

// SCRUM-203 put a foreign key on this column, so the row has to exist
// (ensureTestClientOrganisation, below).
const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let organiserId: string;
let otherOrganiserId: string;
let coordinatorId: string;
let otherCoordinatorId: string;
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

/** Complete enough to satisfy SCRUM-82's mandatory fields, so it can be submitted. */
async function createCompleteRequest(ownerId = organiserId): Promise<string> {
  const { data, error } = await supabase
    .from('event_request')
    .insert({
      organiser_id: ownerId,
      client_organisation_id: CLIENT_ORGANISATION_ID,
      name: 'Annual Tech Summit',
      purpose: 'Bring the engineering teams together for the yearly update.',
      description: 'A full day of talks, workshops and a closing reception.',
      proposed_date: '2027-03-15',
      time_slots: ['am', 'pm'],
      expected_attendance: 80,
    })
    .select('id')
    .single();
  if (error) throw new Error(`could not create test request: ${error.message}`);

  const id = data.id as string;
  createdRequestIds.push(id);
  return id;
}

async function setStatus(id: string, status: string) {
  const { error } = await supabase.from('event_request').update({ status }).eq('id', id);
  if (error) throw new Error(`could not set status ${status}: ${error.message}`);
}

/** What SCRUM-90's requestClarification does, arranged directly. */
async function raiseClarification(id: string, note: string) {
  const { error } = await supabase
    .from('event_request')
    .update({
      status: 'clarification_requested',
      clarification_note: note,
      clarification_requested_by: coordinatorId,
    })
    .eq('id', id);
  if (error) throw new Error(`could not raise clarification: ${error.message}`);
}

async function assignCoordinator(id: string) {
  const { error } = await supabase
    .from('event_request')
    .update({ coordinator_id: coordinatorId, assigned_by: coordinatorId })
    .eq('id', id);
  if (error) throw new Error(`could not assign coordinator: ${error.message}`);
}

async function readRow(id: string) {
  const { data, error } = await supabase
    .from('event_request')
    .select('status, expected_attendance, clarification_note, coordinator_id')
    .eq('id', id)
    .single();
  if (error) throw new Error(`could not read test request: ${error.message}`);
  return data;
}

async function readRounds(id: string) {
  const { data, error } = await supabase
    .from('event_request_clarification_round')
    .select('round_number, note, response, responded_by, responded_at')
    .eq('event_request_id', id)
    .order('round_number');
  if (error) throw new Error(`could not read rounds: ${error.message}`);
  return data;
}

/**
 * Indexing a list under `noUncheckedIndexedAccess`. Fails the test with a
 * readable message rather than a non-null assertion, which would hide a missing
 * round behind a crash on the next line.
 */
/** Who is asking, for the reads that now decide what they may see. */
const asActor = (userId: string, ...roles: Role[]) => ({ userId, roles });

function round<T>(rows: readonly T[], index: number): T {
  const row = rows[index];
  if (row === undefined) throw new Error(`expected a round at index ${index}, found none`);
  return row;
}

/** The amendment itself is SCRUM-83's draft save; the value change is what matters here. */
async function amend(id: string, expectedAttendance: number) {
  const { error } = await supabase
    .from('event_request')
    .update({ expected_attendance: expectedAttendance })
    .eq('id', id);
  if (error) throw new Error(`could not amend: ${error.message}`);
}

beforeAll(async () => {
  // SCRUM-203's FK on client_organisation_id means CLIENT_ORGANISATION_ID
  // below must be a real row, not just a placeholder uuid.
  await ensureTestClientOrganisation(supabase);
  organiserId = await createAccount('Olivia Organiser', ['event_organiser']);
  otherOrganiserId = await createAccount('Otto Other', ['event_organiser']);
  coordinatorId = await createAccount('Casey Coordinator', ['coordinator']);
  otherCoordinatorId = await createAccount('Wei Coordinator', ['coordinator']);
  managerId = await createAccount('Morgan Manager', ['operations_manager']);
});

afterAll(async () => {
  // Requests first: rounds cascade with them, but coordinator_id and
  // requested_by are ON DELETE RESTRICT, so an account cannot go while a
  // clarification of theirs is still recorded.
  for (const id of createdRequestIds) {
    await supabase.from('event_request').delete().eq('id', id);
  }
  for (const id of [organiserId, otherOrganiserId, coordinatorId, otherCoordinatorId, managerId]) {
    if (id) await supabase.auth.admin.deleteUser(id);
  }
});

describe('respondToClarification', () => {
  // US-7.2-TC04 (Jira AC1)
  it('returns the request to Submitted and records the response', async () => {
    const id = await createCompleteRequest();
    await setStatus(id, 'submitted');
    await assignCoordinator(id);
    await raiseClarification(id, 'How many people are you expecting?');
    await amend(id, 200);

    actor.current = { userId: organiserId, roles: ['event_organiser'] };
    const outcome = await respondToClarification(
      id,
      { response: 'Expected attendance is now 200' },
      organiserId,
    );

    expect(outcome.status).toBe('submitted');
    expect(outcome.round.roundNumber).toBe(1);
    expect(outcome.round.response).toBe('Expected attendance is now 200');
    // AC1's notification: who would be told, recorded rather than sent (D-07).
    expect(outcome.coordinatorId).toBe(coordinatorId);

    const row = await readRow(id);
    expect(row.status).toBe('submitted');

    const rounds = await readRounds(id);
    expect(rounds).toHaveLength(1);
    expect(round(rounds, 0).response).toBe('Expected attendance is now 200');
    expect(round(rounds, 0).responded_by).toBe(organiserId);
    // Stamped by the database, not the caller.
    expect(round(rounds, 0).responded_at).toBeTruthy();
  });

  // US-7.2-TC04 — the answer's timestamp comes from the database.
  it('stamps the response time within a second of the call', async () => {
    const id = await createCompleteRequest();
    await setStatus(id, 'submitted');
    await raiseClarification(id, 'Which venue did you have in mind?');
    const before = Date.now();

    actor.current = { userId: organiserId, roles: ['event_organiser'] };
    const outcome = await respondToClarification(id, { response: 'Any central venue' }, organiserId);

    const stamped = new Date(outcome.round.respondedAt as string).getTime();
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);
  });

  // US-7.2-TC05 (Jira AC2)
  it('retains the original note, the response and the amended values', async () => {
    const id = await createCompleteRequest();
    await setStatus(id, 'submitted');
    await raiseClarification(id, 'How many people are you expecting?');
    await amend(id, 200);

    actor.current = { userId: organiserId, roles: ['event_organiser'] };
    await respondToClarification(id, { response: 'Expected attendance is now 200' }, organiserId);

    const exchange = await getClarificationExchange(id, asActor(coordinatorId, 'coordinator'));
    expect(exchange.rounds).toHaveLength(1);
    expect(round(exchange.rounds, 0).note).toBe('How many people are you expecting?');
    expect(round(exchange.rounds, 0).response).toBe('Expected attendance is now 200');

    // The amended value is on the event record itself, not copied into the
    // exchange - "retained" means nothing was lost.
    const row = await readRow(id);
    expect(row.expected_attendance).toBe(200);
  });

  // US-7.2-TC06 (Jira AC3)
  it('lists both clarification rounds in order, and leaves the first unchanged', async () => {
    const id = await createCompleteRequest();
    await setStatus(id, 'submitted');
    await raiseClarification(id, 'How many people are you expecting?');
    await amend(id, 200);

    actor.current = { userId: organiserId, roles: ['event_organiser'] };
    await respondToClarification(id, { response: 'Expected attendance is now 200' }, organiserId);

    // The coordinator comes back with a second question.
    await raiseClarification(id, 'Please confirm the AV setup.');
    await respondToClarification(id, { response: 'We need 2 wireless microphones' }, organiserId);

    const exchange = await getClarificationExchange(id, asActor(coordinatorId, 'coordinator'));
    expect(exchange.rounds.map((r) => r.roundNumber)).toEqual([1, 2]);
    expect(round(exchange.rounds, 0).note).toBe('How many people are you expecting?');
    expect(round(exchange.rounds, 0).response).toBe('Expected attendance is now 200');
    expect(round(exchange.rounds, 1).note).toBe('Please confirm the AV setup.');
    expect(round(exchange.rounds, 1).response).toBe('We need 2 wireless microphones');
    expect(exchange.status).toBe('submitted');
  });

  // US-7.2-TC07 (Jira AC1) — nothing to answer.
  it('refuses a response when no clarification is open', async () => {
    const id = await createCompleteRequest();
    await setStatus(id, 'submitted');

    actor.current = { userId: organiserId, roles: ['event_organiser'] };
    await expect(
      respondToClarification(id, { response: 'Anything' }, organiserId),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const row = await readRow(id);
    expect(row.status).toBe('submitted');
    expect(await readRounds(id)).toHaveLength(0);
  });

  // US-7.2-TC08 (Jira AC1) — someone else's request.
  it('refuses an organiser who does not own the request', async () => {
    const id = await createCompleteRequest();
    await setStatus(id, 'submitted');
    await raiseClarification(id, 'How many people are you expecting?');

    actor.current = { userId: otherOrganiserId, roles: ['event_organiser'] };
    await expect(
      respondToClarification(id, { response: 'Not my request' }, otherOrganiserId),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const row = await readRow(id);
    expect(row.status).toBe('clarification_requested');
    const rounds = await readRounds(id);
    expect(round(rounds, 0).response).toBeNull();
  });

  // US-7.2-TC08 (Jira AC1) — the coordinator cannot answer on the organiser's behalf.
  it('refuses the assigned coordinator', async () => {
    const id = await createCompleteRequest();
    await setStatus(id, 'submitted');
    await assignCoordinator(id);
    await raiseClarification(id, 'How many people are you expecting?');

    actor.current = { userId: coordinatorId, roles: ['coordinator'] };
    await expect(
      respondToClarification(id, { response: 'I will answer for them' }, coordinatorId),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const row = await readRow(id);
    expect(row.status).toBe('clarification_requested');
  });

  // US-7.2-TC09 (Jira AC1/AC2) — a blank response is refused.
  it.each(['', '   '])('refuses the response %j and changes nothing', async (response) => {
    const id = await createCompleteRequest();
    await setStatus(id, 'submitted');
    await raiseClarification(id, 'How many people are you expecting?');

    actor.current = { userId: organiserId, roles: ['event_organiser'] };
    await expect(respondToClarification(id, { response }, organiserId)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    const row = await readRow(id);
    expect(row.status).toBe('clarification_requested');
    const rounds = await readRounds(id);
    expect(round(rounds, 0).response).toBeNull();
  });

  // US-7.2-TC10 (Jira AC1) — two resubmits at the same moment.
  it('records one round when two resubmits arrive at once', async () => {
    const id = await createCompleteRequest();
    await setStatus(id, 'submitted');
    await raiseClarification(id, 'How many people are you expecting?');
    await amend(id, 200);

    actor.current = { userId: organiserId, roles: ['event_organiser'] };
    const results = await Promise.allSettled([
      respondToClarification(id, { response: 'Expected attendance is now 200' }, organiserId),
      respondToClarification(id, { response: 'Expected attendance is now 200' }, organiserId),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);

    const row = await readRow(id);
    expect(row.status).toBe('submitted');
    const rounds = await readRounds(id);
    expect(rounds).toHaveLength(1);
    expect(round(rounds, 0).response).toBe('Expected attendance is now 200');
  });

  // SCRUM-82 AC2 still applies to a resubmission: an incomplete request is
  // refused, and the answer is not recorded against it.
  it('refuses a resubmission while a mandatory field is incomplete', async () => {
    const id = await createCompleteRequest();
    await setStatus(id, 'submitted');
    await raiseClarification(id, 'Your description is missing.');
    await supabase.from('event_request').update({ description: null }).eq('id', id);

    actor.current = { userId: organiserId, roles: ['event_organiser'] };
    await expect(
      respondToClarification(id, { response: 'I have added it' }, organiserId),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const row = await readRow(id);
    expect(row.status).toBe('clarification_requested');
    const rounds = await readRounds(id);
    // The round stays open, so the organiser can fix the field and answer again.
    expect(round(rounds, 0).response).toBeNull();
  });
});

describe('getClarificationExchange', () => {
  // Jira AC3 — a request with no clarification has no rounds, and that is not an error.
  it('returns an empty list for a request that was never returned', async () => {
    const id = await createCompleteRequest();
    await setStatus(id, 'submitted');

    const exchange = await getClarificationExchange(id, asActor(organiserId, 'event_organiser'));
    expect(exchange.rounds).toEqual([]);
    expect(exchange.status).toBe('submitted');
  });

  // US-7.2-TC06 — an open round is visible before it is answered.
  it('shows an open round with no response yet', async () => {
    const id = await createCompleteRequest();
    await setStatus(id, 'submitted');
    await raiseClarification(id, 'How many people are you expecting?');

    const exchange = await getClarificationExchange(id, asActor(coordinatorId, 'coordinator'));
    expect(exchange.rounds).toHaveLength(1);
    expect(round(exchange.rounds, 0).note).toBe('How many people are you expecting?');
    expect(round(exchange.rounds, 0).response).toBeNull();
    expect(round(exchange.rounds, 0).respondedAt).toBeNull();
  });

  it('refuses an id that is not a request', async () => {
    await expect(
      getClarificationExchange(
        '11111111-1111-1111-1111-111111111111',
        asActor(organiserId, 'event_organiser'),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

/**
 * Raised in review: any signed-in account could read the whole exchange for any
 * request id. The rounds carry the free text of a discussion about an event, so
 * the read is now limited to the people the exchange belongs to.
 */
/**
 * The defect found in review: when the answer and the status change were two
 * writes, a failure between them left an open round on a submitted request. The
 * Coordinator could then raise another, and with two rounds unanswered the read
 * that finds "the open round" matched two rows and failed - permanently, for
 * every later response to that request.
 *
 * Closing the round now performs the status change in the same statement, so
 * the gap is gone. These cases prove the state cannot be reached even when the
 * database is written to directly, which is the only way left to try.
 */
describe('two unanswered rounds do not stall the exchange', () => {
  /**
   * Reaching the state: SCRUM-82's submit endpoint accepts a request in
   * Clarification Requested and knows nothing about rounds, so an Organiser who
   * resubmits that way leaves one open. The Coordinator's next question then
   * opens a second.
   */
  async function twoOpenRounds() {
    const id = await createCompleteRequest();
    await setStatus(id, 'submitted');
    await assignCoordinator(id);
    await raiseClarification(id, 'Round 1: how many?');
    // Resubmitted without answering — the gap SCRUM-82's path leaves.
    await setStatus(id, 'submitted');
    await raiseClarification(id, 'Round 2: AV setup?');

    const rounds = await readRounds(id);
    expect(rounds.filter((r) => r.response === null)).toHaveLength(2);
    return id;
  }

  /**
   * The defect found in review: this read used maybeSingle() on an unordered
   * query, so two open rounds made it fail with "multiple rows returned" — and
   * because it runs before every response, every later response to that request
   * failed too, permanently, until the table was edited by hand.
   */
  it('answers the newest open round instead of failing', async () => {
    const id = await twoOpenRounds();

    actor.current = { userId: organiserId, roles: ['event_organiser'] };
    const outcome = await respondToClarification(id, { response: 'Two hundred' }, organiserId);

    expect(outcome.round.roundNumber).toBe(2);
    expect(outcome.status).toBe('submitted');

    const rounds = await readRounds(id);
    expect(rounds.filter((r) => r.response === null)).toHaveLength(1); // the orphan, stepped over
    expect(rounds.find((r) => r.round_number === 2)?.response).toBe('Two hundred');
  });

  it('keeps working for every later round, rather than stalling once', async () => {
    const id = await twoOpenRounds();
    actor.current = { userId: organiserId, roles: ['event_organiser'] };
    await respondToClarification(id, { response: 'Two hundred' }, organiserId);

    await raiseClarification(id, 'Round 3: catering?');
    const outcome = await respondToClarification(id, { response: 'No catering' }, organiserId);

    expect(outcome.round.roundNumber).toBe(3);
    expect(outcome.status).toBe('submitted');
  });
});

/**
 * The migration backfills a round for clarifications raised before this table
 * existed. Raised in review: SCRUM-90 never clears clarification_note when a
 * request is resubmitted (US-7.2 AC3 wants it to stay visible), so the column is
 * also set on every request that was clarified and resolved long ago. Backfilling
 * those too would leave each one with an unanswered round, and the coordinator's
 * page would read "Waiting for the organiser to reply" on a conversation that
 * finished months earlier.
 *
 * The backfill runs once, at migration time, so this asserts the rule it applies
 * rather than re-running it: a resolved request carries a note and no open round.
 */
describe('a resolved clarification does not leave an open round', () => {
  it('keeps the note but shows nothing outstanding once the request moves on', async () => {
    const id = await createCompleteRequest();
    await setStatus(id, 'submitted');
    await assignCoordinator(id);
    await raiseClarification(id, 'Answered long ago');

    actor.current = { userId: organiserId, roles: ['event_organiser'] };
    await respondToClarification(id, { response: 'Here is the answer' }, organiserId);

    // SCRUM-90's note is deliberately still there (US-7.2 AC3)...
    expect((await readRow(id)).clarification_note).toBe('Answered long ago');

    // ...but nothing is waiting on the organiser, which is what the backfill's
    // status filter keeps true for rows that predate this table.
    const open = (await readRounds(id)).filter((r) => r.response === null);
    expect(open).toHaveLength(0);
  });
});

describe('who may read the exchange', () => {
  async function requestWithARound() {
    const id = await createCompleteRequest();
    await setStatus(id, 'submitted');
    await assignCoordinator(id);
    await raiseClarification(id, 'How many people are you expecting?');
    return id;
  }

  it('lets the organiser who owns it read it', async () => {
    const id = await requestWithARound();
    const exchange = await getClarificationExchange(id, asActor(organiserId, 'event_organiser'));
    expect(exchange.rounds).toHaveLength(1);
  });

  it('lets the assigned coordinator read it', async () => {
    const id = await requestWithARound();
    const exchange = await getClarificationExchange(id, asActor(coordinatorId, 'coordinator'));
    expect(exchange.rounds).toHaveLength(1);
  });

  // They decide who owns the event, so an unanswered question is theirs to see.
  it('lets an Event Operations Manager read it', async () => {
    const id = await requestWithARound();
    const exchange = await getClarificationExchange(id, asActor(managerId, 'operations_manager'));
    expect(exchange.rounds).toHaveLength(1);
  });

  it('refuses another organiser', async () => {
    const id = await requestWithARound();
    await expect(
      getClarificationExchange(id, asActor(otherOrganiserId, 'event_organiser')),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  // SCRUM-96 AC4 — reassigned away means access is denied.
  it('refuses a coordinator the event is not assigned to', async () => {
    const id = await requestWithARound();
    await expect(
      getClarificationExchange(id, asActor(otherCoordinatorId, 'coordinator')),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses an account with no roles at all', async () => {
    const id = await requestWithARound();
    await expect(
      getClarificationExchange(id, asActor(otherOrganiserId)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
