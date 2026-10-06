import { describe, it, expect } from 'vitest';
import { showsCommitmentStatement } from '@/domain/review/policy';
import { EventRequestStatusEnum } from '@/domain/event-request/schema';

/**
 * Bug from SCRUM-99 manual testing: the approval panel (SCRUM-92) said "No
 * venue, equipment or registration arrangement is yet committed" on every event
 * that was ever approved, including Confirmed ones, whose status definition says
 * "All essential arrangements are in place".
 *
 * SCRUM-92 AC2/AC3 describe a request that has only been approved, so the
 * statement shows only while the event is Approved. US-7.3-TC05 and TC06
 * (SCRUM-92 AC2, AC3) run on Approved events and are unaffected.
 */

describe('showsCommitmentStatement', () => {
  it('shows the statement while the event is Approved (SCRUM-92 AC2, AC3)', () => {
    expect(showsCommitmentStatement('approved')).toBe(true);
  });

  it.each(['planning', 'confirmed', 'completed', 'cancelled'] as const)(
    'hides it once the event has moved on to %s',
    (status) => {
      expect(showsCommitmentStatement(status)).toBe(false);
    },
  );

  it('shows it for no status other than Approved', () => {
    const shown = EventRequestStatusEnum.options.filter((status) => showsCommitmentStatement(status));
    expect(shown).toEqual(['approved']);
  });
});
