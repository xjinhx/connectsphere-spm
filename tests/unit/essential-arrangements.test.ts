import { describe, expect, it } from 'vitest';
import { EssentialArrangementsInputSchema } from '@/domain/essential-arrangements/schema';
import {
  CONFIRMED_REFUSAL,
  NO_ARRANGEMENTS_RECORDED,
  canChangeEssentialArrangements,
  essentialArrangementsIn,
  essentialArrangementsRefusal,
} from '@/domain/essential-arrangements/policy';
import { EventRequestStatusEnum } from '@/domain/event-request/schema';

/**
 * SCRUM-100 Record which arrangements are essential for an event (Jira,
 * authoritative). The rules, by test case. Storing and reading the set runs
 * against the database in tests/integration/essential-arrangements.test.ts.
 *
 * Test case IDs are from the Sprint 3 sheet's SCRUM-100 tab (TC-100-nn).
 */

const AC1_SET = { venue: 'essential', equipment: 'not_required', technicalSupport: 'not_required', registration: 'not_required' };

function firstMessage(input: unknown): string | undefined {
  const result = EssentialArrangementsInputSchema.safeParse(input);
  return result.success ? undefined : result.error.issues[0]?.message;
}

describe('the essential set (AC1)', () => {
  it('TC-100-01 accepts venue essential and the other three not required', () => {
    expect(EssentialArrangementsInputSchema.parse(AC1_SET)).toEqual(AC1_SET);
  });

  it('refuses an arrangement the card does not name', () => {
    expect(firstMessage({ ...AC1_SET, catering: 'essential' })).toBe(
      'Only venue, equipment, technical support and registration can be marked.',
    );
  });

  it('refuses an answer other than essential or not required, naming the arrangement', () => {
    expect(firstMessage({ ...AC1_SET, venue: 'optional' })).toBe('Venue must be marked as essential or not required.');
  });

  it('refuses a set that leaves an arrangement out, naming it', () => {
    const { registration: _left, ...withoutRegistration } = AC1_SET;
    expect(firstMessage(withoutRegistration)).toBe('Registration must be marked as essential or not required.');
  });
});

describe('which statuses allow a change (AC1, AC3)', () => {
  it('TC-100-01, TC-100-02 allows Approved and Planning', () => {
    expect(canChangeEssentialArrangements('approved')).toBe(true);
    expect(canChangeEssentialArrangements('planning')).toBe(true);
  });

  it('TC-100-04 refuses every other status, naming it', () => {
    for (const status of ['draft', 'submitted', 'clarification_requested', 'rejected', 'completed', 'cancelled'] as const) {
      expect(canChangeEssentialArrangements(status)).toBe(false);
    }
    expect(essentialArrangementsRefusal('submitted')).toBe(
      'Essential arrangements can only be recorded while an event is Approved or in Planning. This event is Submitted.',
    );
  });

  it('TC-100-08 refuses Confirmed and says to return the event to Planning', () => {
    expect(canChangeEssentialArrangements('confirmed')).toBe(false);
    expect(essentialArrangementsRefusal('confirmed')).toBe(CONFIRMED_REFUSAL);
    expect(CONFIRMED_REFUSAL).toMatch(/Return it to Planning/);
  });

  it('gives a refusal for exactly the statuses that do not allow a change', () => {
    for (const status of EventRequestStatusEnum.options) {
      expect(essentialArrangementsRefusal(status) === null).toBe(canChangeEssentialArrangements(status));
    }
  });
});

describe('what is outstanding (AC2)', () => {
  it('TC-100-05 nothing recorded means nothing essential', () => {
    expect(essentialArrangementsIn(NO_ARRANGEMENTS_RECORDED)).toEqual([]);
  });

  it('TC-100-07 lists venue when it is marked essential', () => {
    expect(essentialArrangementsIn(EssentialArrangementsInputSchema.parse(AC1_SET))).toEqual(['venue']);
  });
});
