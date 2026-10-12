import { describe, it, expect } from 'vitest';
import {
  describeEventTimes,
  hasStartTimePassedToday,
  incompleteFields,
  PAST_START_TIME_MESSAGE,
  type StoredEventRequestFields,
} from '@/domain/event-request/policy';
import {
  END_NOT_AFTER_START_MESSAGE,
  eventRequestDraftSchema,
  eventRequestSaveSchema,
} from '@/domain/event-request/schema';
import { END_TIME_OPTIONS, START_TIME_OPTIONS, fromDatabaseTime } from '@/domain/shared/times';
import { currentMinutesInSingapore } from '@/domain/shared/dates';

/**
 * SCRUM-238 — Request event times in 15-minute steps (Event Organiser).
 *
 * AC text is taken from the Jira card, which is authoritative. Test case IDs
 * are from ConnectSphere_TestCases_Sprint3.xlsx, tab SCRUM-238.
 *
 * Supersedes SCRUM-77's slot selection (event-request-time-slots.test.ts).
 *
 * Not coverable by a unit test - verify manually:
 *   AC1 the pickers on /events/new and /events/[id]/edit (TC-238-01, 02)
 *   AC6 a legacy row opens with its slot's times (TC-238-12..14, 21): the
 *       migration fills start_time/end_time; the read is fromDatabaseTime below
 *   AC7 the stored row and a browser in another time zone (TC-238-15, 16)
 */

const A_MONDAY = '2026-11-09';

const basicDetails = {
  name: 'Annual Tech Summit',
  purpose: 'Networking',
  description: 'Yearly gathering',
  proposedDate: '2026-11-15',
};

const complete: StoredEventRequestFields = {
  ...basicDetails,
  startTime: '09:00',
  endTime: '11:00',
  expectedAttendance: 80,
};

/** The issues a schema raised, as { field: message }. */
function fieldErrors(result: { success: boolean; error?: { flatten(): { fieldErrors: Record<string, string[] | undefined> } } }) {
  return result.success ? {} : (result.error?.flatten().fieldErrors ?? {});
}

describe('SCRUM-238 — Request event times in 15-minute steps', () => {
  describe('AC1 — only :00, :15, :30 and :45 are offered', () => {
    // TC-238-01 / 02 — the lists the form's pickers are built from
    it('offers every quarter hour of the day and nothing else', () => {
      const all = [...START_TIME_OPTIONS, ...END_TIME_OPTIONS];
      for (const time of all) expect(time).toMatch(/^\d{2}:(00|15|30|45)$/);
      expect(START_TIME_OPTIONS).toHaveLength(96);
      expect(END_TIME_OPTIONS).toHaveLength(96);
    });

    // TC-238-18 — the latest times of the day can be chosen
    it('starts at 00:00 and ends at 23:45 for a start; 00:15 to 24:00 for an end', () => {
      expect(START_TIME_OPTIONS[0]).toBe('00:00');
      expect(START_TIME_OPTIONS.at(-1)).toBe('23:45');
      expect(END_TIME_OPTIONS[0]).toBe('00:15');
      expect(END_TIME_OPTIONS.at(-1)).toBe('24:00');
    });

    // TC-238-03 — saved and shown back unchanged
    it('keeps a quarter-hour range exactly as entered', () => {
      const saved = eventRequestSaveSchema.parse({ ...basicDetails, startTime: '09:15', endTime: '10:45' });
      expect([saved.startTime, saved.endTime]).toEqual(['09:15', '10:45']);
    });

    // TC-238-17 — shortest range of one step, and TC-238-18's 23:00-23:45
    it('accepts a single 15-minute step and the last steps of the day', () => {
      expect(incompleteFields({ ...complete, startTime: '10:00', endTime: '10:15' }, A_MONDAY)).toEqual([]);
      expect(incompleteFields({ ...complete, startTime: '23:00', endTime: '23:45' }, A_MONDAY)).toEqual([]);
    });

    it('lets a request be saved before its times are chosen', () => {
      const saved = eventRequestSaveSchema.parse({ ...basicDetails, startTime: '', endTime: '' });
      expect([saved.startTime, saved.endTime]).toEqual([undefined, undefined]);
    });
  });

  describe('AC2 — end not after start: refused on save or submit, both fields identified', () => {
    // TC-238-04 — zero-length range, on save, draft save and submit
    it('refuses an end equal to the start, naming both fields', () => {
      const input = { ...basicDetails, startTime: '14:00', endTime: '14:00' };
      for (const schema of [eventRequestSaveSchema, eventRequestDraftSchema]) {
        const errors = fieldErrors(schema.safeParse(input));
        expect(errors.startTime).toEqual([END_NOT_AFTER_START_MESSAGE]);
        expect(errors.endTime).toEqual([END_NOT_AFTER_START_MESSAGE]);
      }
      const submit = incompleteFields({ ...complete, startTime: '14:00', endTime: '14:00' }, A_MONDAY);
      expect(submit.map((item) => item.field)).toEqual(['startTime', 'endTime']);
    });

    // TC-238-05 — end before start
    it('refuses an end before the start, naming both fields', () => {
      const errors = fieldErrors(eventRequestSaveSchema.safeParse({ ...basicDetails, startTime: '15:00', endTime: '13:30' }));
      expect(Object.keys(errors).sort()).toEqual(['endTime', 'startTime']);
    });

    it('refuses only one half of the range, naming the missing half', () => {
      const errors = fieldErrors(eventRequestDraftSchema.safeParse({ name: 'Gala', startTime: '10:00', endTime: '' }));
      expect(Object.keys(errors)).toEqual(['endTime']);
    });

    it('names both times as incomplete at submission when neither was given', () => {
      const result = incompleteFields({ ...complete, startTime: null, endTime: null }, A_MONDAY);
      expect(result.map((item) => item.label)).toEqual(['Start time', 'End time']);
    });
  });

  describe('AC3 — 11:30-13:30 is accepted: no lunch or dinner break', () => {
    // TC-238-06
    it('accepts a range across the former lunch gap', () => {
      expect(incompleteFields({ ...complete, startTime: '11:30', endTime: '13:30' }, A_MONDAY)).toEqual([]);
    });

    // TC-238-07
    it('accepts a range across the former dinner gap', () => {
      expect(incompleteFields({ ...complete, startTime: '17:30', endTime: '19:30' }, A_MONDAY)).toEqual([]);
    });
  });

  describe('AC4 — a time off the 15-minute unit sent to the API is refused', () => {
    // TC-238-08
    it('refuses 10:10', () => {
      const errors = fieldErrors(eventRequestSaveSchema.safeParse({ ...basicDetails, startTime: '10:10', endTime: '12:00' }));
      expect(Object.keys(errors)).toEqual(['startTime']);
    });

    // TC-238-09
    it('refuses a time with seconds', () => {
      expect(eventRequestSaveSchema.safeParse({ ...basicDetails, startTime: '10:15:30', endTime: '12:00' }).success).toBe(false);
    });

    // TC-238-19
    it('accepts 10:15 and refuses one minute either side', () => {
      const parse = (startTime: string) =>
        eventRequestSaveSchema.safeParse({ ...basicDetails, startTime, endTime: '12:00' }).success;
      expect(parse('10:15')).toBe(true);
      expect(parse('10:14')).toBe(false);
      expect(parse('10:16')).toBe(false);
    });

    it('refuses 24:00 as a start and 00:00 as an end', () => {
      expect(eventRequestSaveSchema.safeParse({ ...basicDetails, startTime: '24:00', endTime: '24:00' }).success).toBe(false);
      expect(eventRequestSaveSchema.safeParse({ ...basicDetails, startTime: '00:00', endTime: '00:00' }).success).toBe(false);
    });

    it('reports only the off-step field, not a range error, when one time is invalid', () => {
      const errors = fieldErrors(eventRequestSaveSchema.safeParse({ ...basicDetails, startTime: '10:10', endTime: '09:00' }));
      expect(Object.keys(errors)).toEqual(['startTime']);
    });

    it('applies the same rule to a draft', () => {
      expect(eventRequestDraftSchema.safeParse({ name: 'Gala', startTime: '10:10', endTime: '12:00' }).success).toBe(false);
    });
  });

  describe('AC5 — a start time already passed today is refused (keeps SCRUM-210)', () => {
    const at = (time: string) => new Date(`${A_MONDAY}T${time}:00+08:00`);
    const today = { ...complete, proposedDate: A_MONDAY };

    it('reads "now" in Singapore time, whatever the server clock', () => {
      // 02:05 UTC is 10:05 in Singapore.
      expect(currentMinutesInSingapore(new Date('2026-11-09T02:05:00Z'))).toBe(10 * 60 + 5);
    });

    // TC-238-10 — Regression – SCRUM-210
    it('refuses today 09:00 once it is past 10:00', () => {
      const result = incompleteFields({ ...today, startTime: '09:00', endTime: '11:00' }, A_MONDAY, at('10:30'));
      expect(result).toEqual([{ field: 'startTime', label: 'Start time', reason: PAST_START_TIME_MESSAGE }]);
    });

    // TC-238-11
    it('accepts a start later today', () => {
      expect(incompleteFields({ ...today, startTime: '11:30', endTime: '13:00' }, A_MONDAY, at('10:30'))).toEqual([]);
    });

    // TC-238-20 — Boundary + Regression – SCRUM-210
    it('refuses the step that has just passed and accepts the next one', () => {
      expect(hasStartTimePassedToday('10:00', at('10:05'))).toBe(true);
      expect(hasStartTimePassedToday('10:15', at('10:05'))).toBe(false);
    });

    it('treats a start in the current minute as passed', () => {
      expect(hasStartTimePassedToday('10:00', at('10:00'))).toBe(true);
    });

    it('does not apply to a future date', () => {
      expect(incompleteFields({ ...complete, startTime: '09:00', endTime: '11:00' }, A_MONDAY, at('10:30'))).toEqual([]);
    });

    it('leaves the date-only rules unchanged when `now` is not supplied', () => {
      expect(incompleteFields({ ...today, startTime: '09:00', endTime: '11:00' }, A_MONDAY)).toEqual([]);
    });
  });

  describe('AC6 — a request saved as a slot shows its times', () => {
    // TC-238-12..14. The migration stores AM/PM/Night as these times; the read
    // turns Postgres `time` into HH:MM, keeping 24:00 as 24:00 (not 00:00).
    it.each([
      ['AM', '07:00:00', '12:00:00', '07:00–12:00'],
      ['PM', '13:00:00', '18:00:00', '13:00–18:00'],
      ['Night', '19:00:00', '24:00:00', '19:00–24:00'],
    ])('shows %s as %s-%s', (_slot, start, end, shown) => {
      expect(describeEventTimes(fromDatabaseTime(start), fromDatabaseTime(end))).toBe(shown);
    });

    // TC-238-14 — the edit form loads a Night draft: 24:00 is a valid end
    it('re-saves a Night request ending 24:00', () => {
      expect(eventRequestDraftSchema.safeParse({ name: 'Gala', startTime: '19:00', endTime: '24:00' }).success).toBe(true);
    });

    // TC-238-21 — a legacy PM draft edited to 13:00-17:30 can be submitted
    it('submits a legacy PM request after its end is changed', () => {
      expect(incompleteFields({ ...complete, startTime: '13:00', endTime: '17:30' }, A_MONDAY)).toEqual([]);
    });

    it('shows "not yet provided" until both times are given', () => {
      expect(describeEventTimes(null, null)).toBe('Not yet provided');
    });
  });

  describe('AC7 — Singapore time', () => {
    // TC-238-15 / 16. Times are wall-clock strings, never turned into an
    // instant, so no time zone can shift them.
    it('shows the times exactly as stored', () => {
      expect(describeEventTimes('09:00', '11:00')).toBe('09:00–11:00');
    });
  });
});
