import { describe, expect, it } from 'vitest';
import { RegistrationInputSchema } from '@/domain/event-registration/schema';
import { isEventFull, periodRefusalReason, registrationPeriodRefusal } from '@/domain/event-registration/policy';
import { formatDayMonthYear, todayInSingapore } from '@/domain/shared/dates';

/**
 * SCRUM-181 Register for an event (Jira, authoritative). The form's fields and
 * the registration period rule, by test case. Registering runs through the
 * service in tests/unit/event-registration-service.test.ts and against the
 * database in tests/integration/register-for-event.test.ts.
 *
 * Test case IDs are from SCRUM-181-test-cases.xlsx (TC-181-nn). "Today" is
 * 30/10/2026, Singapore time.
 */

const VALID = { fullName: 'Tan Mei Ling', email: 'attendee@example.com', contactNumber: '+65 9123 4567' };

function fieldErrors(input: unknown) {
  const result = RegistrationInputSchema.safeParse(input);
  return result.success ? {} : result.error.flatten().fieldErrors;
}

/** The Singapore date at a Singapore wall-clock time. */
const sgt = (instant: string) => todayInSingapore(new Date(`${instant}+08:00`));

describe('the registration form (AC1)', () => {
  it('TC-181-01 accepts full name, email address and contact number, trimmed', () => {
    expect(RegistrationInputSchema.parse({ ...VALID, fullName: '  Tan Mei Ling ' })).toEqual(VALID);
  });

  it.each(['fullName', 'email', 'contactNumber'] as const)(
    'TC-181-03 refuses %s when empty, missing or blank, naming only that field',
    (field) => {
      for (const value of ['', undefined, '   ']) {
        const errors = fieldErrors({ ...VALID, [field]: value });
        expect(Object.keys(errors)).toEqual([field]);
      }
    },
  );

  it('TC-181-03 names all three fields together when all are blank', () => {
    expect(fieldErrors({ fullName: '', email: '', contactNumber: '' })).toEqual({
      fullName: ['Enter your full name.'],
      email: ['Enter your email address.'],
      contactNumber: ['Enter your contact number.'],
    });
  });

  it.each(['mei.ling@', 'mei ling@example.com', 'mei.ling.example.com'])(
    'TC-181-04 refuses the email %s, flagging the email field only',
    (email) => {
      expect(fieldErrors({ ...VALID, email })).toEqual({ email: ['Enter a valid email address.'] });
    },
  );
});

describe('the registration period (AC2, AC3, AC4)', () => {
  const TODAY = '2026-10-30';

  it('TC-181-01 an open period (27/10/2026 to 04/11/2026) allows registering', () => {
    expect(registrationPeriodRefusal({ startDate: '2026-10-27', endDate: '2026-11-04' }, TODAY)).toBeNull();
  });

  it('TC-181-05 before the start date, refused with the start date as DD/MM/YYYY', () => {
    const period = { startDate: '2026-11-01', endDate: '2026-11-09' };
    expect(periodRefusalReason(period, TODAY)).toBe('not_started');
    expect(registrationPeriodRefusal(period, TODAY)).toBe('Registration opens on 01/11/2026.');
  });

  it('TC-181-07 the last minutes of the day before the start date are still refused', () => {
    const period = { startDate: '2026-10-31', endDate: '2026-11-09' };
    expect(registrationPeriodRefusal(period, sgt('2026-10-30T23:45:00'))).toBe('Registration opens on 31/10/2026.');
  });

  it('TC-181-08 after the end date, refused with the end date as DD/MM/YYYY', () => {
    const period = { startDate: '2026-10-20', endDate: '2026-10-28' };
    expect(periodRefusalReason(period, TODAY)).toBe('ended');
    expect(registrationPeriodRefusal(period, TODAY)).toBe('Registration closed on 28/10/2026.');
  });

  it('TC-181-10 the first minutes of the day after the end date are refused', () => {
    const period = { startDate: '2026-10-20', endDate: '2026-10-29' };
    // 00:15 SGT on 30/10 is still 29/10 in UTC; Singapore's date decides.
    expect(registrationPeriodRefusal(period, sgt('2026-10-30T00:15:00'))).toBe('Registration closed on 29/10/2026.');
  });

  it('TC-181-11 registering on the start date succeeds (inclusive)', () => {
    expect(registrationPeriodRefusal({ startDate: TODAY, endDate: '2026-11-04' }, TODAY)).toBeNull();
  });

  it('TC-181-12 registering on the end date succeeds (inclusive)', () => {
    expect(registrationPeriodRefusal({ startDate: '2026-10-25', endDate: TODAY }, TODAY)).toBeNull();
  });

  it('TC-181-13 a single-day period is open from 00:15 to 23:45 SGT that day, and closed at 00:15 the next', () => {
    const period = { startDate: TODAY, endDate: TODAY };
    expect(registrationPeriodRefusal(period, sgt('2026-10-30T00:15:00'))).toBeNull();
    expect(registrationPeriodRefusal(period, sgt('2026-10-30T23:45:00'))).toBeNull();
    expect(registrationPeriodRefusal(period, sgt('2026-10-31T00:15:00'))).toBe('Registration closed on 30/10/2026.');
  });
});

describe('dates shown to users', () => {
  it('formats a calendar date as DD/MM/YYYY', () => {
    expect(formatDayMonthYear('2026-11-01')).toBe('01/11/2026');
  });
});

/**
 * SCRUM-182 Refuse registration once the event is full (Jira, authoritative).
 * The full check, by test case (SCRUM-182-test-cases.xlsx, TC-182-nn); the
 * same rule in SQL runs in tests/integration/refuse-full-registration.test.ts.
 */
describe('SCRUM-182 whether the event is full', () => {
  it('TC-182-03 19 of 20 is not full; 20 of 20 is full', () => {
    expect(isEventFull(20, 19)).toBe(false);
    expect(isEventFull(20, 20)).toBe(true);
  });

  it('TC-182-02 no capacity set is full, even with nobody registered (PO, 25/10/2026)', () => {
    expect(isEventFull(null, 0)).toBe(true);
  });
});

describe('SCRUM-182 AC3: a withdrawal gives its place back', () => {
  it('TC-182-10 capacity 2 with 3, then 2 registered is full; with 1 it is open again (PO, 25/10/2026)', () => {
    expect(isEventFull(2, 3)).toBe(true);
    expect(isEventFull(2, 2)).toBe(true);
    expect(isEventFull(2, 1)).toBe(false);
  });
});
