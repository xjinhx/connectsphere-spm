import { describe, expect, it } from 'vitest';
import { END_TIME_OPTIONS, endTimesAfter, keepEndAfterStart, toMinutes } from '@/domain/shared/times';

/**
 * SCRUM-266 Bug fix: the End dropdown let an end at or before the start be
 * picked. Every form's End list now comes from endTimesAfter, and every Start
 * change goes through keepEndAfterStart. The counts are the test cases' own
 * (SCRUM-266 tab, TC-266-01 to 07), which are then run by hand on each form.
 *
 * Exp 1 End offers only times after the chosen Start
 * Exp 2 moving Start to or past the chosen End clears End
 * Exp 3 MarkPeriodUnavailableForm keeps its opening-hours filter
 */

/** The opening-hours list MarkPeriodUnavailableForm builds for a venue open 08:00 to 22:00. */
const withinHours = (opens: string, closes: string) =>
  END_TIME_OPTIONS.filter((time) => toMinutes(time) > toMinutes(opens) && toMinutes(time) <= toMinutes(closes));

describe('endTimesAfter (SCRUM-266 Exp 1)', () => {
  it.each([
    ['TC-266-01', '09:00', '09:15', 60],
    ['TC-266-01', '12:00', '12:15', 48],
    ['TC-266-02', '13:00', '13:15', 44],
    ['TC-266-03', '10:00', '10:15', 56],
    ['TC-266-03', '12:30', '12:45', 46],
    ['TC-266-04', '16:00', '16:15', 32],
    ['TC-266-06', '08:00', '08:15', 64],
    ['TC-266-06', '22:30', '22:45', 6],
    ['TC-266-07', '14:30', '14:45', 38],
  ])('%s: after %s, End runs from %s to 24:00 (%i options), nothing at or before the start', (_tc, start, first, count) => {
    const options = endTimesAfter(start);
    expect(options).toHaveLength(count);
    expect(options[0]).toBe(first);
    expect(options.at(-1)).toBe('24:00');
    expect(options.every((end) => toMinutes(end) > toMinutes(start))).toBe(true);
  });

  it('TC-266-01: after 09:00, 03:30 and 09:00 itself cannot be picked', () => {
    expect(endTimesAfter('09:00')).not.toContain('03:30');
    expect(endTimesAfter('09:00')).not.toContain('09:00');
  });

  it('offers every end time while no start is chosen', () => {
    expect(endTimesAfter('')).toEqual(END_TIME_OPTIONS);
  });

  it('TC-266-09: after 23:45, the last start, End offers only 24:00; after 23:30, 23:45 and 24:00', () => {
    expect(endTimesAfter('23:45')).toEqual(['24:00']);
    expect(endTimesAfter('23:30')).toEqual(['23:45', '24:00']);
  });

  it('TC-266-08: after 09:00, End runs 09:15 to 24:00 (60); after 12:30, 12:45 to 24:00 (46)', () => {
    expect(endTimesAfter('09:00')).toHaveLength(60);
    expect(endTimesAfter('12:30')).toHaveLength(46);
    expect(endTimesAfter('12:30')[0]).toBe('12:45');
  });
});

describe('endTimesAfter on a narrowed list (SCRUM-266 Exp 3, MarkPeriodUnavailableForm)', () => {
  it('TC-266-05: within 08:00 to 22:00, after 09:00 End runs 09:15 to 22:00 (52 options), nothing after closing', () => {
    const options = endTimesAfter('09:00', withinHours('08:00', '22:00'));
    expect(options).toHaveLength(52);
    expect(options[0]).toBe('09:15');
    expect(options.at(-1)).toBe('22:00');
  });

  it('TC-266-05: after 17:00, End runs 17:15 to 22:00 (20 options)', () => {
    expect(endTimesAfter('17:00', withinHours('08:00', '22:00'))).toHaveLength(20);
  });

  it('TC-266-10: after 21:45, the last start before 22:00 closing, End offers only 22:00', () => {
    expect(endTimesAfter('21:45', withinHours('08:00', '22:00'))).toEqual(['22:00']);
  });
});

describe('keepEndAfterStart (SCRUM-266 Exp 2)', () => {
  it.each([
    ['TC-266-01', '12:00', '12:00'],
    ['TC-266-02', '13:00', '12:00'],
    ['TC-266-03', '12:30', '12:00'],
    ['TC-266-04', '16:00', '15:00'],
    ['TC-266-05', '17:00', '16:30'],
    ['TC-266-06', '22:30', '22:00'],
    ['TC-266-07', '14:30', '14:00'],
  ])('%s: moving Start to %s clears an End of %s', (_tc, start, end) => {
    expect(keepEndAfterStart(start, end)).toBe('');
  });

  it('keeps an End still after the new Start', () => {
    expect(keepEndAfterStart('09:00', '12:00')).toBe('12:00');
    expect(keepEndAfterStart('23:45', '24:00')).toBe('24:00');
  });

  it('TC-266-09: moving Start back from 23:45 to 23:30 keeps an End of 24:00', () => {
    expect(keepEndAfterStart('23:30', '24:00')).toBe('24:00');
  });

  it('TC-266-11: a search address with End 14:00 before Start 14:30 opens with End cleared', () => {
    expect(keepEndAfterStart('14:30', '14:00')).toBe('');
  });

  it('leaves End alone while either time is not chosen', () => {
    expect(keepEndAfterStart('', '12:00')).toBe('12:00');
    expect(keepEndAfterStart('09:00', '')).toBe('');
  });
});
