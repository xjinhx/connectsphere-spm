import { describe, it, expect } from 'vitest';
import { affectedBookingMessage } from '@/domain/availability/policy';

/**
 * SCRUM-151 AC2, in times since SCRUM-239 AC6: what the coordinator of an
 * affected booking is told.
 *
 * SCRUM-151 AC1's "only a slot the venue operates can be withdrawn"
 * (findNonOperatingSlots) became "only a period within the venue's opening
 * hours", which reuses Part 1's isWithinOpeningHours (venues/policy.ts), tested
 * with search in venue-search.test.ts and here end to end in
 * tests/integration/venue-unavailable-slots.test.ts.
 */
describe('affectedBookingMessage (SCRUM-151 AC2, SCRUM-239 AC6)', () => {
  it('tells the coordinator the period withdrawn at the venue, and why', () => {
    expect(affectedBookingMessage('Bugis Seminar Room', '2026-10-20', { start: '14:00', end: '16:30' }, 'Ceiling repair')).toBe(
      'Your booking at Bugis Seminar Room is affected: 20 Oct 2026 14:00–16:30 is no longer available (Ceiling repair).',
    );
  });
});
