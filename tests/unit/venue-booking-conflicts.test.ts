import { describe, it, expect } from 'vitest';
import {
  approvalConflictsFor,
  describeApprovalConflict,
  isNonAdjacentSlots,
  legacySuggestionPeriods,
  periodCommittedMessage,
} from '@/domain/venue-booking/policy';
import { DecisionResultSchema } from '@/domain/venue-booking/schema';
import type { VenueCommitment } from '@/domain/availability/schema';

/**
 * SCRUM-239 AC4 (Jira): "Given a request was submitted before an overlapping
 * booking was confirmed, when Venue Staff tries to approve it, then approval
 * is refused and the clashing period and the event holding it are named (as
 * SCRUM-155 AC1)." With SCRUM-155's rules carried into time ranges (SCRUM-155
 * stays Done on slots): AC1 a booking identified, AC4 a competing request
 * rejected, AC5 an unavailable period refused with its reason.
 */

const LINE = '33333333-3333-4333-8333-333333333333';
const VENUE = '11111111-1111-4111-8111-111111111111';
const SUMMIT_ID = '55555555-5555-4555-8555-555555555555';
const SUMMIT = { reference: 'EVT-2026-0101', name: 'Tech Summit' };
const EVENTS = new Map([[SUMMIT_ID, SUMMIT]]);
const DATE = '2026-11-15';

const line = { id: LINE, date: DATE, start: '11:00', end: '13:00', legacySlots: null };

const commitment = (kind: VenueCommitment['kind'], start: string, end: string, extra: Partial<VenueCommitment> = {}): VenueCommitment => ({
  kind,
  venueId: VENUE,
  date: DATE,
  start,
  end,
  eventRequestId: kind === 'unavailable' ? null : SUMMIT_ID,
  reason: kind === 'unavailable' ? 'Aircon repair' : null,
  ...extra,
});

describe('approvalConflictsFor (AC4)', () => {
  it('TC-239-10: names the overlapping confirmed booking and the event holding it', () => {
    expect(approvalConflictsFor(line, [commitment('booking', '10:00', '12:00')], EVENTS)).toEqual([
      { lineId: LINE, date: DATE, start: '10:00', end: '12:00', kind: 'booked', event: SUMMIT },
    ]);
  });

  it('TC-239-11: finds nothing for a booking that ends as the line starts', () => {
    expect(approvalConflictsFor({ ...line, start: '12:00', end: '14:00' }, [commitment('booking', '10:00', '12:00')], EVENTS)).toEqual([]);
  });

  it('finds nothing on a different date (TC-155-08)', () => {
    expect(approvalConflictsFor(line, [commitment('booking', '10:00', '12:00', { date: '2026-11-14' })], EVENTS)).toEqual([]);
  });

  it('names an unavailable period with its reason (AC8, TC-155-10)', () => {
    expect(approvalConflictsFor(line, [commitment('unavailable', '12:30', '16:30')], EVENTS)).toEqual([
      { lineId: LINE, date: DATE, start: '12:30', end: '16:30', kind: 'unavailable', reason: 'Aircon repair' },
    ]);
  });

  it("names another event's hold with its expiry (SCRUM-227 AC4)", () => {
    const hold = commitment('hold', '12:00', '14:00', { expiresAt: '2026-11-13T09:00:00.000Z' });
    expect(approvalConflictsFor(line, [hold], EVENTS)).toEqual([
      { lineId: LINE, date: DATE, start: '12:00', end: '14:00', kind: 'held', event: SUMMIT, expiresAt: '2026-11-13T09:00:00.000Z' },
    ]);
  });

  it('refuses a line from before the switch asking for AM and Night as one period', () => {
    const legacy = { id: LINE, date: DATE, start: '07:00', end: '24:00', legacySlots: ['am', 'night'] };
    expect(approvalConflictsFor(legacy, [], EVENTS)).toEqual([
      { lineId: LINE, date: DATE, start: '07:00', end: '24:00', kind: 'non_adjacent_slots' },
    ]);
  });
});

describe('isNonAdjacentSlots (PR #89 follow-up: AM + Night is refused)', () => {
  it.each([
    [['am', 'night'], true],
    [['am', 'pm', 'night'], false],
    [['am', 'pm'], false],
    [['pm', 'night'], false],
    [null, false],
  ])('%j -> %s', (slots, expected) => {
    expect(isNonAdjacentSlots(slots)).toBe(expected);
  });
});

describe('legacySuggestionPeriods (PR #100 review: AM + Night suggestion is not 07:00-24:00)', () => {
  it('gives each slot its own period, so PM is not offered', () => {
    expect(legacySuggestionPeriods(['night', 'am'])).toEqual([
      { start: '07:00', end: '12:00' },
      { start: '19:00', end: '24:00' },
    ]);
  });

  it('gives nothing for no slots', () => {
    expect(legacySuggestionPeriods([])).toEqual([]);
  });
});

describe('describeApprovalConflict (AC4)', () => {
  it('TC-239-10: names the clashing period and the event holding it', () => {
    expect(
      describeApprovalConflict({ lineId: LINE, date: DATE, start: '10:00', end: '12:00', kind: 'booked', event: SUMMIT }),
    ).toBe('10:00–12:00 on 15 Nov 2026 is already booked for EVT-2026-0101 (Tech Summit).');
  });

  it('gives the recorded reason for an unavailable period', () => {
    expect(
      describeApprovalConflict({ lineId: LINE, date: '2026-11-22', start: '14:00', end: '16:30', kind: 'unavailable', reason: 'Aircon repair' }),
    ).toBe('14:00–16:30 on 22 Nov 2026 is unavailable: Aircon repair.');
  });

  it('names a hold and when it expires, in Singapore time', () => {
    expect(
      describeApprovalConflict({
        lineId: LINE,
        date: DATE,
        start: '12:00',
        end: '14:00',
        kind: 'held',
        event: SUMMIT,
        expiresAt: '2026-11-13T09:00:00.000Z',
      }),
    ).toBe('12:00–14:00 on 15 Nov 2026 is held for EVT-2026-0101 (Tech Summit) until 13 Nov 2026 17:00.');
  });

  it('tells Venue Staff to reject an AM + Night line', () => {
    expect(
      describeApprovalConflict({ lineId: LINE, date: DATE, start: '07:00', end: '24:00', kind: 'non_adjacent_slots' }),
    ).toMatch(/^This line was requested as AM and Night on 15 Nov 2026, .* Reject it/);
  });
});

describe('periodCommittedMessage (SCRUM-155 AC4 in times)', () => {
  it('tells the competing coordinator which period went to another event', () => {
    expect(periodCommittedMessage('Marina Bay Ballroom', [{ date: '2026-11-17', start: '19:00', end: '24:00' }])).toBe(
      'Your booking request for Marina Bay Ballroom was rejected for 17 Nov 2026 19:00–24:00: the period is now committed to another event.',
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

  it.each(['held', 'non_adjacent_slots', 'unavailable'])('knows the %s outcome', (outcome) => {
    expect(DecisionResultSchema.parse({ outcome }).outcome).toBe(outcome);
  });
});
