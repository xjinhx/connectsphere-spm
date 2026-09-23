import { describe, expect, it } from 'vitest';
import { capacityToSend } from '@/components/venue/capacityInput';

/**
 * SCRUM-116 AC3: a bad capacity is flagged, never quietly turned into a
 * different number. The venue form sends what capacityToSend returns and the
 * server's schema decides; these check the form does not decide first.
 */

describe('capacityToSend: SCRUM-116 AC3', () => {
  it.each([
    ['150', 150],
    ['  150  ', 150],
    ['150.0', 150],
    ['0', 0],
    ['-5', -5],
    ['3000000000', 3000000000],
  ])('sends the whole number "%s" as %d, so the server gives the exact reason', (typed, sent) => {
    expect(capacityToSend(typed)).toBe(sent);
  });

  // Number() reads every one of these as a number; each used to save as, or
  // be judged as, a capacity nobody typed.
  it.each([
    '2e2',
    '0x1F',
    '0b11',
    '0o17',
    '+5',
    '12.',
    '.5e1',
    'Infinity',
    '150.5',
    '1.9999999999999999',
    '150.00000000000001',
    '9'.repeat(400),
  ])('sends "%s" as typed, so the server refuses it instead of saving another number', (typed) => {
    expect(capacityToSend(typed)).toBe(typed);
  });

  it('sends text and an empty box as typed', () => {
    expect(capacityToSend('abc')).toBe('abc');
    expect(capacityToSend('   ')).toBe('');
  });
});
