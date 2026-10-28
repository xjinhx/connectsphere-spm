import { describe, expect, it } from 'vitest';
import { END_TIME_OPTIONS, endTimesAfter, keepEndAfterStart, toMinutes } from '@/domain/shared/times';

/**
 * SCRUM-266 Bug fix: the End dropdown let an end at or before the start be
 * picked. Every form's End list now comes from endTimesAfter, and every Start
 * change goes through keepEndAfterStart. The test case IDs are the SCRUM-266
 * tab's (TC-266-01 to 06), run by hand on each form.
 *
 * Exp 1 End offers only times after the chosen Start
 * Exp 2 moving Start to or past the chosen End clears End
 * Exp 3 MarkPeriodUnavailableForm keeps its opening-hours filter
 */

/** The opening-hours list MarkPeriodUnavailableForm builds for a venue open `opens` to `closes`. */
const withinHours = (opens: string, closes: string) =>
  END_TIME_OPTIONS.filter((time) => toMinutes(time) > toMinutes(opens) && toMinutes(time) <= toMinutes(closes));

describe('TC-266-01 to 03: End offers only times after Start (Exp 1)', () => {
  it.each([
    ['TC-266-01', 'event request form', '09:00', '09:15'],
    ['TC-266-01', 'event request form', '12:00', '12:15'],
    ['TC-266-02', 'request a venue', '13:00', '13:15'],
    ['TC-266-02', 'change date and times', '12:30', '12:45'],
    ['TC-266-02', 'venue search', '14:30', '14:45'],
    ['TC-266-03', 'reject with a suggestion', '10:00', '10:15'],
    ['TC-266-03', 'hold this venue', '16:00', '16:15'],
    ['TC-266-03', 'opening hours', '22:30', '22:45'],
  ])('%s (%s): after %s, End starts at %s and runs to 24:00, nothing at or before the start', (_tc, _form, start, first) => {
    const options = endTimesAfter(start);
    expect(options[0]).toBe(first);
    expect(options.at(-1)).toBe('24:00');
    expect(options.every((end) => toMinutes(end) > toMinutes(start))).toBe(true);
  });

  it('TC-266-01: after 09:00, 03:30 and 09:00 itself cannot be picked', () => {
    expect(endTimesAfter('09:00')).not.toContain('03:30');
    expect(endTimesAfter('09:00')).not.toContain('09:00');
  });

  it('TC-266-03 (mark unavailable): within 08:00 to 22:00, after 09:00 End runs 09:15 to 22:00, nothing after closing', () => {
    const options = endTimesAfter('09:00', withinHours('08:00', '22:00'));
    expect(options[0]).toBe('09:15');
    expect(options.at(-1)).toBe('22:00');
  });

  it('offers every end time while no start is chosen', () => {
    expect(endTimesAfter('')).toEqual(END_TIME_OPTIONS);
  });
});

describe('TC-266-01 to 03: moving Start to or past End clears End (Exp 2)', () => {
  it.each([
    ['TC-266-01', 'event request form', '12:00', '12:00'],
    ['TC-266-02', 'request a venue', '13:00', '12:00'],
    ['TC-266-02', 'change date and times', '12:30', '12:00'],
    ['TC-266-02', 'venue search', '14:30', '14:00'],
    ['TC-266-03', 'reject with a suggestion', '12:30', '12:00'],
    ['TC-266-03', 'hold this venue', '16:00', '15:00'],
    ['TC-266-03', 'mark unavailable', '17:00', '16:30'],
    ['TC-266-03', 'opening hours', '22:30', '22:00'],
  ])('%s (%s): moving Start to %s clears an End of %s', (_tc, _form, start, end) => {
    expect(keepEndAfterStart(start, end)).toBe('');
  });

  it('keeps an End still after the new Start', () => {
    expect(keepEndAfterStart('09:00', '12:00')).toBe('12:00');
  });

  it('leaves End alone while either time is not chosen', () => {
    expect(keepEndAfterStart('', '12:00')).toBe('12:00');
    expect(keepEndAfterStart('09:00', '')).toBe('');
  });
});

describe('TC-266-04 and 05: boundaries', () => {
  it('TC-266-04: after 23:45, the last start of the day, End offers only 24:00', () => {
    expect(endTimesAfter('23:45')).toEqual(['24:00']);
  });

  it('TC-266-04: moving Start back from 23:45 to 23:30 keeps an End of 24:00, still after it', () => {
    expect(keepEndAfterStart('23:30', '24:00')).toBe('24:00');
    expect(endTimesAfter('23:30')).toEqual(['23:45', '24:00']);
  });

  it('TC-266-05: within 08:00 to 22:00, after 21:45 End offers only 22:00, the closing time (Exp 3)', () => {
    expect(endTimesAfter('21:45', withinHours('08:00', '22:00'))).toEqual(['22:00']);
  });
});

describe('TC-266-06: a bad range typed into the search address', () => {
  it('opens with End cleared when the address has End 14:00 before Start 14:30', () => {
    expect(keepEndAfterStart('14:30', '14:00')).toBe('');
  });
});
