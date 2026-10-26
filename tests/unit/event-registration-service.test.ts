import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SCRUM-181 Register for an event (Jira, authoritative). registerForEvent
 * decides everything (the period, the duplicate, the fields) before it writes,
 * so the data layer is replaced with spies and nothing here needs a database.
 * That the row really lands in Postgres, and the database function's own
 * checks, run in tests/integration/register-for-event.test.ts.
 *
 * Test case IDs are from SCRUM-181-test-cases.xlsx (TC-181-nn). The clock is
 * fixed at 30/10/2026 10:00 Singapore time unless a test says otherwise.
 */

vi.mock('@/lib/supabase/eventRegistrations', () => ({
  fetchRegistrationEvent: vi.fn(),
  fetchRegisteredRegistration: vi.fn(),
  createRegistrationRow: vi.fn(),
}));

import {
  createRegistrationRow,
  fetchRegisteredRegistration,
  fetchRegistrationEvent,
} from '@/lib/supabase/eventRegistrations';
import { getRegistrationPage, registerForEvent } from '@/domain/event-registration/service';
import { ALREADY_REGISTERED } from '@/domain/event-registration/policy';
import { CapacityExceededError, ConflictError, NotFoundError, ValidationError } from '@/domain/shared/errors';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const ATTENDEE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ATTENDEE_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const VALID = { fullName: 'Tan Mei Ling', email: 'attendee@example.com', contactNumber: '+65 9123 4567' };
const NOW = new Date('2026-10-30T10:00:00+08:00');

const ROW = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  reference: 'REG-2026-0001',
  event_request_id: EVENT_ID,
  full_name: VALID.fullName,
  email: VALID.email,
  contact_number: VALID.contactNumber,
  status: 'registered',
  registered_at: '2026-10-30T02:00:00+00:00',
};

function eventWithPeriod(start: string | null, end: string | null) {
  vi.mocked(fetchRegistrationEvent).mockResolvedValue({
    data: {
      id: EVENT_ID,
      name: 'Client Appreciation Night',
      proposed_date: '2026-11-15',
      registration_start_date: start,
      registration_end_date: end,
    },
    error: null,
  } as never);
}

/** The attendee's Registered row: none before the insert, then `after` once it has run. */
function registrations(before: typeof ROW | null, after: typeof ROW | null = before) {
  vi.mocked(fetchRegisteredRegistration)
    .mockReset()
    .mockResolvedValueOnce({ data: before, error: null } as never)
    .mockResolvedValue({ data: after, error: null } as never);
}

function databaseSays(outcome: string) {
  vi.mocked(createRegistrationRow).mockResolvedValue({ data: outcome, error: null } as never);
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
  eventWithPeriod('2026-10-27', '2026-11-04');
  registrations(null, ROW);
  databaseSays('registered');
});

describe('AC1: registering with the period open and places remaining', () => {
  it('TC-181-01 creates one Registered registration with the three details, and returns it as the confirmation', async () => {
    const registration = await registerForEvent(EVENT_ID, ATTENDEE, VALID, NOW);

    expect(createRegistrationRow).toHaveBeenCalledTimes(1);
    expect(createRegistrationRow).toHaveBeenCalledWith(EVENT_ID, ATTENDEE, VALID, '2026-10-30');
    expect(registration).toMatchObject({
      reference: 'REG-2026-0001',
      status: 'registered',
      fullName: VALID.fullName,
      email: VALID.email,
      contactNumber: VALID.contactNumber,
    });
  });

  it('TC-181-03 a form with all three fields blank names each one, and nothing is written', async () => {
    const error = await refusal(registerForEvent(EVENT_ID, ATTENDEE, { fullName: '', email: '', contactNumber: '' }, NOW));

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).details).toMatchObject({
      fieldErrors: {
        fullName: ['Enter your full name.'],
        email: ['Enter your email address.'],
        contactNumber: ['Enter your contact number.'],
      },
    });
    expect(createRegistrationRow).not.toHaveBeenCalled();
  });

  it('TC-181-04 an invalid email is refused, flagging the email, and nothing is written', async () => {
    const error = await refusal(registerForEvent(EVENT_ID, ATTENDEE, { ...VALID, email: 'mei.ling@' }, NOW));

    expect((error as ValidationError).details).toMatchObject({ fieldErrors: { email: ['Enter a valid email address.'] } });
    expect(createRegistrationRow).not.toHaveBeenCalled();
  });

  it('refuses when the database finds no places remaining (SCRUM-182 decides when; D-23 never says so yet)', async () => {
    databaseSays('full');
    await expect(registerForEvent(EVENT_ID, ATTENDEE, VALID, NOW)).rejects.toThrow(CapacityExceededError);
  });
});

describe('AC2: before the registration start date', () => {
  it('TC-181-05 is refused with the start date shown, and nothing is written', async () => {
    eventWithPeriod('2026-11-01', '2026-11-09');

    const error = await refusal(registerForEvent(EVENT_ID, ATTENDEE, VALID, NOW));

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toBe('Registration opens on 01/11/2026.');
    expect(createRegistrationRow).not.toHaveBeenCalled();
  });

  it('TC-181-07 at 23:45 SGT the day before the start date, still refused', async () => {
    eventWithPeriod('2026-10-31', '2026-11-09');

    await expect(
      registerForEvent(EVENT_ID, ATTENDEE, VALID, new Date('2026-10-30T23:45:00+08:00')),
    ).rejects.toThrow('Registration opens on 31/10/2026.');
    expect(createRegistrationRow).not.toHaveBeenCalled();
  });
});

describe('AC3: after the registration end date', () => {
  it('TC-181-08 is refused with the end date shown, and nothing is written', async () => {
    eventWithPeriod('2026-10-20', '2026-10-28');

    await expect(registerForEvent(EVENT_ID, ATTENDEE, VALID, NOW)).rejects.toThrow('Registration closed on 28/10/2026.');
    expect(createRegistrationRow).not.toHaveBeenCalled();
  });

  it('TC-181-10 at 00:15 SGT the day after the end date, refused', async () => {
    eventWithPeriod('2026-10-20', '2026-10-29');

    await expect(
      registerForEvent(EVENT_ID, ATTENDEE, VALID, new Date('2026-10-30T00:15:00+08:00')),
    ).rejects.toThrow('Registration closed on 29/10/2026.');
    expect(createRegistrationRow).not.toHaveBeenCalled();
  });

  it('the period is checked before the fields, so a closed period is not reported field by field', async () => {
    eventWithPeriod('2026-10-20', '2026-10-28');
    await expect(
      registerForEvent(EVENT_ID, ATTENDEE, { fullName: '', email: '', contactNumber: '' }, NOW),
    ).rejects.toThrow('Registration closed on 28/10/2026.');
  });
});

describe('AC4: both dates are inclusive', () => {
  it('TC-181-11 registering on the start date succeeds', async () => {
    eventWithPeriod('2026-10-30', '2026-11-04');
    await expect(registerForEvent(EVENT_ID, ATTENDEE, VALID, NOW)).resolves.toMatchObject({ status: 'registered' });
    expect(createRegistrationRow).toHaveBeenCalledTimes(1);
  });

  it('TC-181-12 registering on the end date succeeds', async () => {
    eventWithPeriod('2026-10-25', '2026-10-30');
    await expect(registerForEvent(EVENT_ID, ATTENDEE, VALID, NOW)).resolves.toMatchObject({ status: 'registered' });
    expect(createRegistrationRow).toHaveBeenCalledTimes(1);
  });

  it('TC-181-13 a single-day period: 00:15 and 23:45 SGT succeed, 00:15 SGT the next day is refused', async () => {
    eventWithPeriod('2026-10-30', '2026-10-30');

    await registerForEvent(EVENT_ID, ATTENDEE, VALID, new Date('2026-10-30T00:15:00+08:00'));
    registrations(null, ROW);
    await registerForEvent(EVENT_ID, ATTENDEE_2, VALID, new Date('2026-10-30T23:45:00+08:00'));
    registrations(null, ROW);
    await expect(
      registerForEvent(EVENT_ID, ATTENDEE, VALID, new Date('2026-10-31T00:15:00+08:00')),
    ).rejects.toThrow('Registration closed on 30/10/2026.');

    expect(createRegistrationRow).toHaveBeenCalledTimes(2);
    // Both passed the Singapore date, not the UTC one (29/10 at 00:15 SGT).
    expect(vi.mocked(createRegistrationRow).mock.calls.map((call) => call[3])).toEqual(['2026-10-30', '2026-10-30']);
  });
});

describe('AC5: registering again for the same event', () => {
  it('TC-181-14 is refused with the existing registration attached, even with a different contact number', async () => {
    for (const contactNumber of ['+65 9123 4567', '+65 8000 1111']) {
      registrations(ROW);
      const error = await refusal(registerForEvent(EVENT_ID, ATTENDEE, { ...VALID, contactNumber }, NOW));

      expect(error).toBeInstanceOf(ConflictError);
      expect((error as Error).message).toBe(ALREADY_REGISTERED);
      expect((error as ConflictError).details).toMatchObject({ registration: { reference: 'REG-2026-0001' } });
    }
    expect(createRegistrationRow).not.toHaveBeenCalled();
  });

  it('TC-181-14 shows the existing registration even after the period has closed', async () => {
    eventWithPeriod('2026-10-20', '2026-10-28');
    registrations(ROW);
    await expect(registerForEvent(EVENT_ID, ATTENDEE, VALID, NOW)).rejects.toThrow(ALREADY_REGISTERED);
  });

  it('TC-181-15 when another request registered the attendee first, the database refuses and the existing one is shown', async () => {
    registrations(null, ROW);
    databaseSays('already_registered');

    const error = await refusal(registerForEvent(EVENT_ID, ATTENDEE, VALID, NOW));

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).details).toMatchObject({ registration: { reference: 'REG-2026-0001' } });
  });

  it('TC-181-16 another attendee can still register for the same event', async () => {
    await registerForEvent(EVENT_ID, ATTENDEE_2, VALID, NOW);
    expect(fetchRegisteredRegistration).toHaveBeenCalledWith(EVENT_ID, ATTENDEE_2);
    expect(createRegistrationRow).toHaveBeenCalledWith(EVENT_ID, ATTENDEE_2, VALID, '2026-10-30');
  });
});

describe('AC6: no limit on how many events', () => {
  it('TC-181-17, TC-181-18 only this event is looked at, so registrations elsewhere (even at the same time) do not matter', async () => {
    await registerForEvent(EVENT_ID, ATTENDEE, VALID, NOW);
    // Only ever asked about this event, never the attendee's other registrations.
    for (const call of vi.mocked(fetchRegisteredRegistration).mock.calls) expect(call[0]).toBe(EVENT_ID);
    expect(createRegistrationRow).toHaveBeenCalledTimes(1);
  });
});

describe('which events can be registered for', () => {
  it('an unknown or malformed id is not found', async () => {
    vi.mocked(fetchRegistrationEvent).mockResolvedValue({ data: null, error: null } as never);
    await expect(registerForEvent(EVENT_ID, ATTENDEE, VALID, NOW)).rejects.toThrow(NotFoundError);
    await expect(registerForEvent('not-an-id', ATTENDEE, VALID, NOW)).rejects.toThrow(NotFoundError);
  });

  it('an event with no registration period is not found, so nothing about it is shown', async () => {
    eventWithPeriod(null, null);
    await expect(registerForEvent(EVENT_ID, ATTENDEE, VALID, NOW)).rejects.toThrow(NotFoundError);
    await expect(getRegistrationPage(EVENT_ID, ATTENDEE, NOW)).rejects.toThrow(NotFoundError);
  });
});

describe("the attendee's event page", () => {
  it('shows the period refusal before the start date (AC2) and none while open (AC4)', async () => {
    eventWithPeriod('2026-11-01', '2026-11-09');
    registrations(null);
    expect((await getRegistrationPage(EVENT_ID, ATTENDEE, NOW)).periodRefusal).toBe('Registration opens on 01/11/2026.');

    eventWithPeriod('2026-10-30', '2026-10-30');
    expect((await getRegistrationPage(EVENT_ID, ATTENDEE, NOW)).periodRefusal).toBeNull();
  });

  it("includes the viewer's existing registration (AC5)", async () => {
    registrations(ROW);
    const view = await getRegistrationPage(EVENT_ID, ATTENDEE, NOW);
    expect(view.registration).toMatchObject({ reference: 'REG-2026-0001' });
    expect(view).toMatchObject({ eventName: 'Client Appreciation Night', eventDate: '2026-11-15' });
  });
});
