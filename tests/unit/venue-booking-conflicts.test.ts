import { describe, it, expect } from 'vitest';
import {
  describeApprovalConflict,
  findApprovalConflicts,
  slotCommittedMessage,
} from '@/domain/venue-booking/policy';
import { DecisionResultSchema } from '@/domain/venue-booking/schema';

/**
 * SCRUM-155 Block approval of a conflicting booking (Jira, authoritative).
 * AC1: an approval that overlaps a confirmed booking is refused and the booking
 * identified. AC4: approving one of two competing requests rejects the other.
 * AC5: an approval on a slot recorded as unavailable is refused, with the reason.
 */

const LINE = '33333333-3333-4333-8333-333333333333';
const SUMMIT = { reference: 'EVT-2026-0101', name: 'Tech Summit' };

describe('findApprovalConflicts (AC1, AC5)', () => {
  const line = { id: LINE, date: '2026-11-15', timeSlots: ['am'] };

  it('finds a confirmed booking on the same date and slot, with its event (TC-155-01)', () => {
    expect(findApprovalConflicts([line], [{ date: '2026-11-15', slot: 'am', event: SUMMIT }], [])).toEqual([
      { lineId: LINE, date: '2026-11-15', slot: 'am', kind: 'booked', event: SUMMIT },
    ]);
  });

  it('finds nothing for the same slot on a different date (TC-155-08)', () => {
    expect(findApprovalConflicts([line], [{ date: '2026-11-14', slot: 'am', event: SUMMIT }], [])).toEqual([]);
  });

  it('finds nothing for a different slot on the same date (TC-155-07)', () => {
    expect(findApprovalConflicts([line], [{ date: '2026-11-15', slot: 'pm', event: SUMMIT }], [])).toEqual([]);
  });

  it('finds a slot recorded as unavailable, with its reason (TC-155-10)', () => {
    expect(findApprovalConflicts([line], [], [{ date: '2026-11-15', slot: 'am', reason: 'Aircon repair' }])).toEqual([
      { lineId: LINE, date: '2026-11-15', slot: 'am', kind: 'unavailable', reason: 'Aircon repair' },
    ]);
  });
});

describe('describeApprovalConflict (AC1, AC5)', () => {
  it('names the event holding the slot', () => {
    expect(describeApprovalConflict({ lineId: LINE, date: '2026-11-15', slot: 'am', kind: 'booked', event: SUMMIT })).toBe(
      'AM on 15 Nov 2026 is already booked for EVT-2026-0101 (Tech Summit).',
    );
  });

  it('gives the recorded reason for an unavailable slot', () => {
    expect(
      describeApprovalConflict({ lineId: LINE, date: '2026-11-22', slot: 'am', kind: 'unavailable', reason: 'Aircon repair' }),
    ).toBe('AM on 22 Nov 2026 is unavailable: Aircon repair.');
  });
});

describe('slotCommittedMessage (AC4)', () => {
  it('tells the competing coordinator which slot went to another event', () => {
    expect(slotCommittedMessage('Marina Bay Ballroom', [{ date: '2026-11-17', timeSlots: ['night'] }])).toBe(
      'Your booking request for Marina Bay Ballroom was rejected for 17 Nov 2026 Night: the slot is now committed to another event.',
    );
  });
});

describe("DecisionResultSchema (the database function's result)", () => {
  it('defaults to no auto-rejected requests', () => {
    expect(DecisionResultSchema.parse({ outcome: 'already_decided' })).toEqual({
      outcome: 'already_decided',
      autoRejectedRequestIds: [],
    });
  });
});
