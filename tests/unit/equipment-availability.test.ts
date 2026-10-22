import { describe, expect, it } from 'vitest';
import {
  addDays,
  availableUnits,
  checkLines,
  commitmentWindow,
  heldOnBusiestDay,
} from '@/domain/equipment-reservation/policy';

/**
 * SCRUM-167: the availability rules on their own, in
 * src/domain/equipment-reservation/policy.ts. Against the database, through
 * the service, in tests/integration/equipment-availability.test.ts.
 *
 * Dates follow the B1 sheet: F = 10/11/26, so S4-E1 (booked 10 to 12 Nov) has
 * the window 9 to 12 Nov. Test case IDs are from the B1 test case sheet (CL-46).
 */

const E1 = { start: '2026-11-09', end: '2026-11-12' };
const held = (quantity: number, start: string, end: string) => ({ quantity, window: { start, end } });

describe('commitmentWindow (167 AC1, AC3)', () => {
  it('runs from the day before the first booked day to the last, whatever order the dates come in', () => {
    expect(commitmentWindow(['2026-11-12', '2026-11-10', '2026-11-11'])).toEqual(E1);
  });

  it('is two days for a one-day event: collection the day before, Return Day the day itself', () => {
    expect(commitmentWindow(['2026-11-20'])).toEqual({ start: '2026-11-19', end: '2026-11-20' });
  });

  it('crosses a month end', () => {
    expect(commitmentWindow(['2026-12-01'])).toEqual({ start: '2026-11-30', end: '2026-12-01' });
  });

  it('is null with no confirmed booking, which the check refuses (167 AC3)', () => {
    expect(commitmentWindow([])).toBeNull();
  });

  it('has no cap on its length: 30 booked days is a 31-day window', () => {
    const dates = Array.from({ length: 30 }, (_, i) => addDays('2026-12-01', i));
    expect(commitmentWindow(dates)).toEqual({ start: '2026-11-30', end: '2026-12-30' });
  });
});

describe('heldOnBusiestDay (167 AC1, AC2, AC5 to AC9)', () => {
  it('TC-167-01 (AC1): a hold that starts on L+1 is not counted', () => {
    expect(heldOnBusiestDay([held(4, '2026-11-13', '2026-11-15')], E1)).toBe(0);
  });

  it('TC-167-02 (AC2, AC8): a hold whose Return Day is my collection day is counted', () => {
    expect(heldOnBusiestDay([held(4, '2026-11-07', '2026-11-09')], E1)).toBe(4);
  });

  it('TC-167-07 (AC5): a hold sharing only my last day is counted', () => {
    expect(heldOnBusiestDay([held(4, '2026-11-12', '2026-11-14')], E1)).toBe(4);
  });

  it('TC-167-08 (AC6): a morning and an afternoon event on the same date share the day', () => {
    const sameDay = { start: '2026-11-19', end: '2026-11-20' };
    expect(heldOnBusiestDay([held(4, '2026-11-19', '2026-11-20')], sameDay)).toBe(4);
  });

  it('TC-167-09 (AC7): a Return Day the day before my collection day is not counted', () => {
    expect(heldOnBusiestDay([held(4, '2026-11-06', '2026-11-08')], E1)).toBe(0);
  });

  it('TC-167-10 (AC9): holds on different days count against the busiest day, not the sum', () => {
    expect(
      heldOnBusiestDay([held(4, '2026-11-07', '2026-11-09'), held(4, '2026-11-12', '2026-11-14')], E1),
    ).toBe(4);
  });

  it('adds holds that share a day', () => {
    expect(
      heldOnBusiestDay([held(3, '2026-11-10', '2026-11-12'), held(1, '2026-11-11', '2026-11-13')], E1),
    ).toBe(4);
  });
});

describe('availableUnits (167 Definitions)', () => {
  it("is the item quantity less other events' busiest day", () => {
    expect(availableUnits(10, 4)).toBe(6);
  });

  it('is never below 0', () => {
    expect(availableUnits(4, 6)).toBe(0);
  });
});

describe('checkLines (167 AC4)', () => {
  const line = (requested: number, alreadyReserved: number, equipmentId = 'item') => ({
    lineId: `${equipmentId}-${requested}-${alreadyReserved}`,
    equipmentId,
    equipmentName: 'Projector',
    requested,
    alreadyReserved,
  });

  it('TC-167-04: a fully covered request has a shortfall of 0', () => {
    expect(checkLines([line(2, 0)], new Map([['item', 10]]))).toMatchObject([
      { requested: 2, alreadyReserved: 0, available: 10, shortfall: 0 },
    ]);
  });

  it('TC-167-05: a partly available request shows its shortfall', () => {
    expect(checkLines([line(6, 0)], new Map([['item', 4]]))).toMatchObject([{ available: 4, shortfall: 2 }]);
  });

  it("TC-167-06: the event's own reservation is part of what is available to it, so it creates no shortfall", () => {
    expect(checkLines([line(6, 4)], new Map([['item', 10]]))).toMatchObject([
      { requested: 6, alreadyReserved: 4, available: 10, shortfall: 0 },
    ]);
  });

  it('6 requested of an item with only 4 units, all 4 reserved for this event, leaves a shortfall of 2', () => {
    expect(checkLines([line(6, 4)], new Map([['item', 4]]))).toMatchObject([{ available: 4, shortfall: 2 }]);
  });

  it('shares what is available between two lines of the same item, in order', () => {
    expect(checkLines([line(4, 0), line(3, 0)], new Map([['item', 5]])).map((l) => l.shortfall)).toEqual([0, 2]);
  });

  it('keeps different items apart', () => {
    const result = checkLines([line(4, 0, 'a'), line(4, 0, 'b')], new Map([['a', 4], ['b', 1]]));
    expect(result.map((l) => l.shortfall)).toEqual([0, 3]);
  });
});
