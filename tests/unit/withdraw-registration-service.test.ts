import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SCRUM-184 Withdraw my registration (Jira, authoritative). The service
 * decides everything before it writes, so the data layer is replaced with
 * spies and nothing here needs a database. That the row really changes in
 * Postgres, and gives its place back, runs in
 * tests/integration/withdraw-registration.test.ts.
 *
 * Test case IDs are from SCRUM-184-test-cases.xlsx (TC-184-nn). The clock is
 * fixed at 30/10/2026 10:00 Singapore time unless a test says otherwise.
 */

vi.mock('@/lib/supabase/eventRegistrations', () => ({
  countRegisteredRegistrations: vi.fn(),
  fetchRegistrationEvent: vi.fn(),
  fetchRegisteredRegistration: vi.fn(),
  createRegistrationRow: vi.fn(),
  fetchRegistrationById: vi.fn(),
  withdrawRegistrationRow: vi.fn(),
  fetchAttendeeRegistrations: vi.fn(),
}));

import {
  countRegisteredRegistrations,
  fetchAttendeeRegistrations,
  fetchRegisteredRegistration,
  fetchRegistrationById,
  fetchRegistrationEvent,
  withdrawRegistrationRow,
} from '@/lib/supabase/eventRegistrations';
import { getRegistrationPage, listMyRegistrations, withdrawRegistration } from '@/domain/event-registration/service';
import { ALREADY_WITHDRAWN, EVENT_TAKEN_PLACE, canWithdraw } from '@/domain/event-registration/policy';
import { DomainError, NotFoundError } from '@/domain/shared/errors';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_EVENT_ID = '22222222-2222-4222-8222-222222222222';
const ATTENDEE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ATTENDEE_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REGISTRATION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOW = new Date('2026-10-30T10:00:00+08:00');

const ROW = {
  id: REGISTRATION_ID,
  reference: 'REG-2026-0001',
  event_request_id: EVENT_ID,
  full_name: 'Tan Mei Ling',
  email: 'attendee@example.com',
  contact_number: '+65 9123 4567',
  status: 'registered',
  registered_at: '2026-10-30T02:00:00+00:00',
};

/** The registration as fetchRegistrationById reads it: `attendee_id` is whose it is. */
function stored(overrides: Partial<typeof ROW & { attendee_id: string }> = {}) {
  vi.mocked(fetchRegistrationById).mockResolvedValue({
    data: { ...ROW, attendee_id: ATTENDEE, ...overrides },
    error: null,
  } as never);
}

/** What the guarded update returns: the row now Withdrawn, or null when nothing was Registered. */
function updateReturns(row: typeof ROW | null) {
  vi.mocked(withdrawRegistrationRow).mockResolvedValue({ data: row, error: null } as never);
}

/** The event the registration is for, held on `date` (its proposed_date). */
function eventOn(date: string | null) {
  vi.mocked(fetchRegistrationEvent).mockResolvedValue({
    data: {
      id: EVENT_ID,
      name: 'Client Appreciation Night',
      proposed_date: date,
      registration_start_date: '2026-10-27',
      registration_end_date: '2026-11-04',
      registration_capacity: 20,
    },
    error: null,
  } as never);
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal');
}

beforeEach(() => {
  vi.clearAllMocks();
  stored();
  updateReturns({ ...ROW, status: 'withdrawn' });
  eventOn('2026-11-15');
});

describe('SCRUM-184 AC1: withdrawing an active registration', () => {
  it('TC-184-01 sets the registration to Withdrawn, for this registration and attendee only', async () => {
    const registration = await withdrawRegistration(EVENT_ID, REGISTRATION_ID, ATTENDEE, NOW);

    expect(registration).toMatchObject({ id: REGISTRATION_ID, reference: 'REG-2026-0001', status: 'withdrawn' });
    expect(withdrawRegistrationRow).toHaveBeenCalledTimes(1);
    expect(withdrawRegistrationRow).toHaveBeenCalledWith(REGISTRATION_ID, ATTENDEE);
  });

  it('TC-184-03 one already Withdrawn is refused, and nothing is written', async () => {
    stored({ status: 'withdrawn' });

    const error = await refusal(withdrawRegistration(EVENT_ID, REGISTRATION_ID, ATTENDEE, NOW));

    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: 'INVALID_TRANSITION', message: ALREADY_WITHDRAWN });
    expect(withdrawRegistrationRow).not.toHaveBeenCalled();
  });

  it('TC-184-03 withdrawn by another request after the read: refused the same way, not as an error', async () => {
    updateReturns(null);

    const error = await refusal(withdrawRegistration(EVENT_ID, REGISTRATION_ID, ATTENDEE, NOW));

    expect(error).toMatchObject({ code: 'INVALID_TRANSITION', message: ALREADY_WITHDRAWN });
  });

  it("TC-184-04 another attendee's registration is not found, and nothing is written", async () => {
    stored({ attendee_id: ATTENDEE_2 });

    await expect(withdrawRegistration(EVENT_ID, REGISTRATION_ID, ATTENDEE, NOW)).rejects.toThrow(NotFoundError);
    expect(withdrawRegistrationRow).not.toHaveBeenCalled();
  });

  it('TC-184-04 a registration on another event, an unknown id or a malformed id is not found', async () => {
    await expect(withdrawRegistration(OTHER_EVENT_ID, REGISTRATION_ID, ATTENDEE, NOW)).rejects.toThrow(NotFoundError);

    vi.mocked(fetchRegistrationById).mockResolvedValue({ data: null, error: null } as never);
    await expect(withdrawRegistration(EVENT_ID, REGISTRATION_ID, ATTENDEE, NOW)).rejects.toThrow(NotFoundError);

    await expect(withdrawRegistration(EVENT_ID, 'not-a-uuid', ATTENDEE, NOW)).rejects.toThrow(NotFoundError);
    expect(withdrawRegistrationRow).not.toHaveBeenCalled();
  });
});

/** The attendee's registrations as fetchAttendeeRegistrations reads them, newest first. */
function myRows(...rows: (typeof ROW & { event_request: { name: string; proposed_date: string | null } })[]) {
  vi.mocked(fetchAttendeeRegistrations).mockResolvedValue({ data: rows, error: null } as never);
}

const NIGHT = { name: 'Client Appreciation Night', proposed_date: '2026-11-15' };
const LUNCH = { name: 'Partner Networking Lunch', proposed_date: '2026-11-20' };

describe('SCRUM-184 AC2: a withdrawn registration is shown as Withdrawn, not removed', () => {
  it('TC-184-05 lists both registrations, the withdrawn one with its status and reference', async () => {
    myRows(
      { ...ROW, status: 'withdrawn', event_request: NIGHT },
      { ...ROW, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', reference: 'REG-2026-0002', event_request: LUNCH },
    );

    const list = await listMyRegistrations(ATTENDEE, NOW);

    expect(fetchAttendeeRegistrations).toHaveBeenCalledWith(ATTENDEE);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      eventName: 'Client Appreciation Night',
      eventDate: '2026-11-15',
      registration: { reference: 'REG-2026-0001', status: 'withdrawn' },
      canWithdraw: false,
    });
    expect(list[1]).toMatchObject({
      eventName: 'Partner Networking Lunch',
      registration: { reference: 'REG-2026-0002', status: 'registered' },
      canWithdraw: true,
    });
  });

  it('TC-184-06 withdrawn then registered again for the same event: both rows, each with its own reference', async () => {
    myRows(
      { ...ROW, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', reference: 'REG-2026-0002', event_request: NIGHT },
      { ...ROW, status: 'withdrawn', event_request: NIGHT },
    );

    const list = await listMyRegistrations(ATTENDEE, NOW);

    expect(list.map((row) => [row.registration.reference, row.registration.status, row.canWithdraw])).toEqual([
      ['REG-2026-0002', 'registered', true],
      ['REG-2026-0001', 'withdrawn', false],
    ]);
  });
});

describe('SCRUM-184 AC3: no withdraw once the event has taken place (CL-69: from its event date)', () => {
  const at = (iso: string) => new Date(iso);

  it('TC-184-07 a past event: the policy says no, the service refuses and writes nothing, the page offers no Withdraw', async () => {
    expect(canWithdraw('2026-10-20', '2026-10-30')).toBe(false);
    eventOn('2026-10-20');

    const error = await refusal(withdrawRegistration(EVENT_ID, REGISTRATION_ID, ATTENDEE, NOW));

    expect(error).toMatchObject({ code: 'INVALID_TRANSITION', message: EVENT_TAKEN_PLACE });
    expect(withdrawRegistrationRow).not.toHaveBeenCalled();

    vi.mocked(fetchRegisteredRegistration).mockResolvedValue({ data: ROW, error: null } as never);
    vi.mocked(countRegisteredRegistrations).mockResolvedValue({ count: 10, error: null } as never);
    const page = await getRegistrationPage(EVENT_ID, ATTENDEE, NOW);
    expect(page.registration?.status).toBe('registered');
    expect(page.canWithdraw).toBe(false);
  });

  it('TC-184-07 a past event in My registrations: still listed, with no Withdraw', async () => {
    myRows({ ...ROW, event_request: { name: 'Client Appreciation Night', proposed_date: '2026-10-20' } });

    const [row] = await listMyRegistrations(ATTENDEE, NOW);

    expect(row).toMatchObject({ registration: { status: 'registered' }, canWithdraw: false });
  });

  it('TC-184-08 on the event date itself it has taken place, from 00:00 Singapore time (16:00 UTC the day before)', async () => {
    expect(canWithdraw('2026-11-15', '2026-11-15')).toBe(false);
    eventOn('2026-11-15');

    for (const now of ['2026-11-15T09:00:00+08:00', '2026-11-14T16:00:00Z']) {
      const error = await refusal(withdrawRegistration(EVENT_ID, REGISTRATION_ID, ATTENDEE, at(now)));
      expect(error).toMatchObject({ code: 'INVALID_TRANSITION', message: EVENT_TAKEN_PLACE });
    }
    expect(withdrawRegistrationRow).not.toHaveBeenCalled();

    myRows({ ...ROW, event_request: { name: 'Client Appreciation Night', proposed_date: '2026-11-15' } });
    expect((await listMyRegistrations(ATTENDEE, at('2026-11-15T09:00:00+08:00')))[0]?.canWithdraw).toBe(false);
  });

  it('TC-184-09 the day before, up to 23:59 Singapore time, Withdraw is still offered and works', async () => {
    expect(canWithdraw('2026-11-15', '2026-11-14')).toBe(true);
    eventOn('2026-11-15');
    const lastMinute = at('2026-11-14T23:59:00+08:00');

    await expect(withdrawRegistration(EVENT_ID, REGISTRATION_ID, ATTENDEE, lastMinute)).resolves.toMatchObject({
      status: 'withdrawn',
    });

    vi.mocked(fetchRegisteredRegistration).mockResolvedValue({ data: ROW, error: null } as never);
    vi.mocked(countRegisteredRegistrations).mockResolvedValue({ count: 20, error: null } as never);
    expect((await getRegistrationPage(EVENT_ID, ATTENDEE, lastMinute)).canWithdraw).toBe(true);
  });

  it('an event with no date yet has not taken place; with no registration, nothing to withdraw', async () => {
    expect(canWithdraw(null, '2026-10-30')).toBe(true);

    vi.mocked(fetchRegisteredRegistration).mockResolvedValue({ data: null, error: null } as never);
    vi.mocked(countRegisteredRegistrations).mockResolvedValue({ count: 10, error: null } as never);
    expect((await getRegistrationPage(EVENT_ID, ATTENDEE, NOW)).canWithdraw).toBe(false);
  });

  it('already withdrawn is said before taken place', async () => {
    stored({ status: 'withdrawn' });
    eventOn('2026-10-20');

    const error = await refusal(withdrawRegistration(EVENT_ID, REGISTRATION_ID, ATTENDEE, NOW));

    expect(error).toMatchObject({ message: ALREADY_WITHDRAWN });
  });
});
