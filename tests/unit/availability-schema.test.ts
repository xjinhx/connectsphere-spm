import { describe, it, expect } from 'vitest';
import { MarkPeriodUnavailableInputSchema } from '@/domain/availability/schema';

/**
 * SCRUM-239 AC6 (Jira, authoritative): "Given Venue Staff mark a venue
 * unavailable from 14:00 to 16:30, when they save, then only bookings
 * overlapping that period are flagged — SCRUM-151's behaviour applied to time
 * ranges." SCRUM-151 AC1's date and reason stay; the slots become a start and
 * end time on the 15-minute unit (the shared ClockRangeSchema).
 */
describe('MarkPeriodUnavailableInputSchema', () => {
  const valid = { date: '2026-11-10', start: '14:00', end: '16:30', reason: 'Ceiling repair' };

  function fieldErrors(input: unknown) {
    const result = MarkPeriodUnavailableInputSchema.safeParse(input);
    return result.success ? {} : result.error.flatten().fieldErrors;
  }

  it('accepts a date, a start and end time, and a reason (14:00-16:30)', () => {
    expect(MarkPeriodUnavailableInputSchema.parse(valid)).toEqual(valid);
  });

  it('trims the reason', () => {
    expect(MarkPeriodUnavailableInputSchema.parse({ ...valid, reason: '  Ceiling repair  ' }).reason).toBe('Ceiling repair');
  });

  it('refuses a reason that is blank once trimmed', () => {
    expect(fieldErrors({ ...valid, reason: '   ' })).toEqual({ reason: ['A reason is required.'] });
  });

  it('refuses a time off the 15-minute step', () => {
    expect(fieldErrors({ ...valid, start: '14:10' })).toEqual({
      start: ['Choose a time on a 15-minute step (:00, :15, :30 or :45).'],
    });
  });

  it('refuses an end not after the start, on both fields', () => {
    const message = 'The end time must be after the start time.';
    expect(fieldErrors({ ...valid, start: '16:30', end: '14:00' })).toEqual({ start: [message], end: [message] });
  });

  it('accepts a period ending at midnight (24:00)', () => {
    expect(MarkPeriodUnavailableInputSchema.safeParse({ ...valid, start: '19:00', end: '24:00' }).success).toBe(true);
  });

  it('refuses a date that does not exist', () => {
    expect(fieldErrors({ ...valid, date: '2026-02-30' })).toEqual({ date: ['Choose a valid date.'] });
  });
});
