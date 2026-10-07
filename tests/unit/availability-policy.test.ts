import { describe, it, expect } from 'vitest';
import { affectedBookingMessage, findNonOperatingSlots } from '@/domain/availability/policy';

/**
 * SCRUM-151 AC1: only a slot the venue operates can be marked unavailable.
 * A slot it does not operate is never offered (SCRUM-116 AC4), so there is
 * nothing to withdraw.
 */
describe('findNonOperatingSlots', () => {
  it('finds nothing when the venue operates every chosen slot', () => {
    expect(findNonOperatingSlots(['am', 'pm'], ['am', 'pm', 'night'])).toEqual([]);
  });

  it('names a chosen slot the venue does not operate', () => {
    expect(findNonOperatingSlots(['am', 'night'], ['am', 'pm'])).toEqual(['night']);
  });

  it('keeps the order the slots were chosen in', () => {
    expect(findNonOperatingSlots(['night', 'pm', 'am'], ['am'])).toEqual(['night', 'pm']);
  });
});

describe('affectedBookingMessage (SCRUM-151 AC2)', () => {
  it("tells the coordinator which of the booking's slots were withdrawn, and why", () => {
    expect(affectedBookingMessage('Bugis Seminar Room', '2026-10-20', ['am', 'pm'], 'Ceiling repair')).toBe(
      'Your booking at Bugis Seminar Room is affected: 20 Oct 2026 AM + PM is no longer available (Ceiling repair).',
    );
  });
});
