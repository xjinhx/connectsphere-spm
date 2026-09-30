import { describe, it, expect } from 'vitest';
import { committedSlotsByVenue, isFreeInEverySlot } from '@/domain/venues/policy';
import { VenueSearchQuerySchema, type OperatingSlot } from '@/domain/venues/schema';

/**
 * SCRUM-128 Search venues by date and slot — the pure rules.
 * tests/integration/venue-search.test.ts runs the same criteria against Postgres.
 *
 * AC1 "Given I enter a date and select one or more slots, when I search, then a
 *     venue is returned only if it is free in every one of the selected slots,
 *     and is excluded if it is committed in any one of them."
 * AC2 "... a confirmed booking in the PM slot and I search for the PM slot ...
 *     that venue is excluded."
 * AC3 "... a confirmed booking in the AM slot and I search for the PM slot only
 *     ... that venue is returned."
 * AC4 "... a venue's Night slot has been recorded as unavailable and I search
 *     for the Night slot ... that venue is excluded."
 * AC5 "Given I search for a date 5 years from today ... results are returned,
 *     because no booking horizon applies."
 *
 * Test case IDs are from Self_Owned_ScrumsTest.xlsx, sheet SCRUM-128.
 */

const ALL: OperatingSlot[] = ['am', 'pm', 'night'];
const committed = (...slots: OperatingSlot[]) => new Set<OperatingSlot>(slots);

describe('isFreeInEverySlot: SCRUM-128 AC1 to AC4', () => {
  it('TC-128-01: free in the one selected slot is returned (AC1)', () => {
    expect(isFreeInEverySlot(ALL, ['am'], undefined)).toBe(true);
  });

  it('TC-128-02 / TC-128-09: free in every selected slot is returned (AC1)', () => {
    expect(isFreeInEverySlot(ALL, ['am', 'pm'], committed())).toBe(true);
    expect(isFreeInEverySlot(ALL, ['am', 'pm', 'night'], committed())).toBe(true);
  });

  it('TC-128-03 / TC-128-10: committed in any one selected slot is excluded (AC1)', () => {
    expect(isFreeInEverySlot(ALL, ['am', 'pm'], committed('pm'))).toBe(false);
    expect(isFreeInEverySlot(ALL, ['am', 'pm', 'night'], committed('night'))).toBe(false);
  });

  it('TC-128-04: committed in the searched slot is excluded (AC2)', () => {
    expect(isFreeInEverySlot(ALL, ['pm'], committed('pm'))).toBe(false);
  });

  it('TC-128-05: committed only in another slot is returned (AC3)', () => {
    expect(isFreeInEverySlot(ALL, ['pm'], committed('am'))).toBe(true);
  });

  it('a slot the venue does not operate is not free', () => {
    expect(isFreeInEverySlot(['am', 'pm'], ['night'], undefined)).toBe(false);
    expect(isFreeInEverySlot(['am', 'pm'], ['am', 'night'], undefined)).toBe(false);
    expect(isFreeInEverySlot(['am', 'pm'], ['am'], undefined)).toBe(true);
  });
});

describe('committedSlotsByVenue: SCRUM-128 AC2 to AC4', () => {
  it('collects every committed slot per venue, from bookings and unavailability alike', () => {
    const byVenue = committedSlotsByVenue([
      { venueId: 'v1', slot: 'am' },
      { venueId: 'v1', slot: 'pm' },
      { venueId: 'v2', slot: 'night' },
      { venueId: 'v1', slot: 'am' },
    ]);
    expect(byVenue.get('v1')).toEqual(committed('am', 'pm'));
    expect(byVenue.get('v2')).toEqual(committed('night'));
    expect(byVenue.get('v3')).toBeUndefined();
  });

  it('TC-128-05: an AM booking commits only AM, not the neighbouring PM (AC3 as written)', () => {
    const byVenue = committedSlotsByVenue([{ venueId: 'v1', slot: 'am' }]);
    expect(byVenue.get('v1')).toEqual(committed('am'));
  });

  it('ignores a slot value it does not recognise rather than guessing', () => {
    expect(committedSlotsByVenue([{ venueId: 'v1', slot: 'evening' }]).get('v1')).toBeUndefined();
  });
});

describe('VenueSearchQuerySchema: SCRUM-128 AC1 and AC5', () => {
  it('accepts a date and one or more slots, in slot order with repeats dropped (AC1)', () => {
    const parsed = VenueSearchQuerySchema.parse({ date: '2026-11-20', slots: ['night', 'am', 'am'] });
    expect(parsed).toEqual({ date: '2026-11-20', slots: ['am', 'night'] });
  });

  it('TC-128-08: a date five years ahead is accepted — no booking horizon (AC5)', () => {
    expect(VenueSearchQuerySchema.safeParse({ date: '2031-10-01', slots: ['am'] }).success).toBe(true);
    expect(VenueSearchQuerySchema.safeParse({ date: '2099-12-31', slots: ['am'] }).success).toBe(true);
  });

  it('TC-128-13: no slot selected is refused (AC1 "one or more slots")', () => {
    const result = VenueSearchQuerySchema.safeParse({ date: '2026-11-20', slots: [] });
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.slots).toEqual(['Select at least one slot.']);
  });

  it('refuses a missing date, a malformed date and a date that does not exist', () => {
    expect(VenueSearchQuerySchema.safeParse({ slots: ['am'] }).success).toBe(false);
    expect(VenueSearchQuerySchema.safeParse({ date: '20/11/2026', slots: ['am'] }).success).toBe(false);
    expect(VenueSearchQuerySchema.safeParse({ date: '2026-02-30', slots: ['am'] }).success).toBe(false);
  });

  it('refuses a slot that is not AM, PM or Night', () => {
    expect(VenueSearchQuerySchema.safeParse({ date: '2026-11-20', slots: ['evening'] }).success).toBe(false);
  });
});
