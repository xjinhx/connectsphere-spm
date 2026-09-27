import { describe, it, expect } from 'vitest';
import { findNonOperatingSlots } from '@/domain/availability/policy';

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
