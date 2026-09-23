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
    ['0', 0],
    ['-5', -5],
    ['150.5', 150.5],
  ])('sends the plain number "%s" as %d, so the server gives the exact reason', (typed, sent) => {
    expect(capacityToSend(typed)).toBe(sent);
  });

  // Number() reads all of these as numbers; each one used to save as a
  // capacity nobody typed.
  it.each(['2e2', '0x1F', '0b11', '0o17', '+5', '12.', '.5e1', 'Infinity'])(
    'sends "%s" as typed, so the server refuses it instead of saving another number',
    (typed) => {
      expect(capacityToSend(typed)).toBe(typed);
    },
  );

  it('sends text and an empty box as typed', () => {
    expect(capacityToSend('abc')).toBe('abc');
    expect(capacityToSend('   ')).toBe('');
  });
});
