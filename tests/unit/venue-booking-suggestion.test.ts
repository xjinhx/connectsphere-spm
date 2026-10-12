import { describe, it, expect } from 'vitest';
import { DecideVenueBookingRequestInputSchema } from '@/domain/venue-booking/schema';

/**
 * SCRUM-150 Suggest an alternative venue or arrangement (Jira, authoritative).
 * AC1: rejecting a line may add a suggested venue, date and period (a start
 * and end time since SCRUM-239), kept with the decision. The suggestion is
 * optional and never replaces the reason.
 */

const LINE = '33333333-3333-4333-8333-333333333333';
const VENUE = '44444444-4444-4444-8444-444444444444';
const SUGGESTION = { venueId: VENUE, date: '2026-10-24', start: '13:00', end: '18:00' };

function firstMessage(decision: Record<string, unknown>): string | undefined {
  const result = DecideVenueBookingRequestInputSchema.safeParse({ decisions: [{ lineId: LINE, ...decision }] });
  return result.success ? undefined : result.error.issues[0]?.message;
}

describe('a suggestion on a rejected line (AC1)', () => {
  it('accepts a rejection with a reason and a suggestion (TC-150-01)', () => {
    expect(firstMessage({ decision: 'reject', reason: 'Orchid Room too small', suggestion: SUGGESTION })).toBeUndefined();
  });

  it('accepts a rejection with no suggestion (TC-150-06)', () => {
    expect(firstMessage({ decision: 'reject', reason: 'Private function' })).toBeUndefined();
  });

  it('still needs a reason when there is a suggestion (TC-150-07)', () => {
    expect(firstMessage({ decision: 'reject', reason: '', suggestion: SUGGESTION })).toBe(
      'A reason is required for each rejected line.',
    );
  });

  it('refuses a suggestion on an approved line', () => {
    expect(firstMessage({ decision: 'approve', suggestion: SUGGESTION })).toBe('A suggestion can only go with a rejected line.');
  });

  it('refuses a suggestion with no venue chosen', () => {
    expect(firstMessage({ decision: 'reject', reason: 'Too small', suggestion: { ...SUGGESTION, venueId: '' } })).toBe(
      'Choose a venue to suggest.',
    );
  });

  it('refuses a suggestion with no start time', () => {
    const { start: _start, ...withoutStart } = SUGGESTION;
    expect(firstMessage({ decision: 'reject', reason: 'Too small', suggestion: withoutStart })).toBe(
      'Choose a start time to suggest.',
    );
  });

  it('refuses a suggested period that ends before it starts', () => {
    expect(
      firstMessage({ decision: 'reject', reason: 'Too small', suggestion: { ...SUGGESTION, start: '18:00', end: '13:00' } }),
    ).toBe('The end time must be after the start time.');
  });
});
