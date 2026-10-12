import { describe, it, expect } from 'vitest';
import { ReleaseVenueBookingInputSchema } from '@/domain/venue-booking/schema';

/**
 * SCRUM-231 Release one venue booking without affecting the event's others
 * (Jira, authoritative). AC1: "when I release one of them and give a reason,
 * then that booking becomes Released".
 *
 * The reason rule, by test case. Releasing itself, AC2-AC4, runs against the
 * database in tests/integration/venue-booking-release.test.ts.
 */

function releaseMessage(input: unknown): string | undefined {
  const result = ReleaseVenueBookingInputSchema.safeParse(input);
  return result.success ? undefined : result.error.issues[0]?.message;
}

describe('the reason for releasing (AC1)', () => {
  it('refuses an empty reason (TC-231-04)', () => {
    expect(releaseMessage({ reason: '' })).toBe('A reason is required to release a booking.');
  });

  it('treats a reason of only spaces as empty (TC-231-04)', () => {
    expect(releaseMessage({ reason: '   ' })).toBe('A reason is required to release a booking.');
  });

  it('refuses a release with no reason at all', () => {
    expect(releaseMessage({})).toBe('A reason is required to release a booking.');
  });

  it('accepts a one-character reason (TC-231-05)', () => {
    expect(releaseMessage({ reason: 'x' })).toBeUndefined();
  });

  it('keeps the reason without its surrounding spaces', () => {
    expect(ReleaseVenueBookingInputSchema.parse({ reason: '  Breakout moved  ' }).reason).toBe('Breakout moved');
  });
});
