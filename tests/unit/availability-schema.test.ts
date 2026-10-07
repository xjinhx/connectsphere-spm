import { describe, it, expect } from 'vitest';
import { MarkSlotsUnavailableInputSchema } from '@/domain/availability/schema';

/**
 * SCRUM-151 AC1 (Jira, authoritative): "Given I select a venue, a date and the
 * affected slots and record a reason, when I save, then those slots are
 * recorded as unavailable ..."
 */
describe('MarkSlotsUnavailableInputSchema', () => {
  const valid = { date: '2026-10-03', slots: ['am', 'pm'], reason: 'Ceiling repair' };

  function firstMessage(input: unknown): string | undefined {
    const result = MarkSlotsUnavailableInputSchema.safeParse(input);
    return result.success ? undefined : result.error.issues[0]?.message;
  }

  it('accepts a date, several slots and a reason in one save', () => {
    expect(MarkSlotsUnavailableInputSchema.parse(valid)).toEqual(valid);
  });

  it('trims the reason', () => {
    expect(MarkSlotsUnavailableInputSchema.parse({ ...valid, reason: '  Ceiling repair  ' }).reason).toBe(
      'Ceiling repair',
    );
  });

  it('refuses a reason that is blank once trimmed', () => {
    expect(firstMessage({ ...valid, reason: '   ' })).toBe('A reason is required.');
  });

  it('refuses a save with no slot ticked', () => {
    expect(firstMessage({ ...valid, slots: [] })).toBe('Select at least one slot.');
  });

  it('refuses the same slot twice', () => {
    expect(firstMessage({ ...valid, slots: ['am', 'am'] })).toBe('Each slot can only be selected once.');
  });

  it('refuses a slot that is not AM, PM or Night', () => {
    expect(MarkSlotsUnavailableInputSchema.safeParse({ ...valid, slots: ['evening'] }).success).toBe(false);
  });

  it('refuses a date that does not exist', () => {
    expect(firstMessage({ ...valid, date: '2026-02-30' })).toBe('Choose a valid date.');
  });
});
