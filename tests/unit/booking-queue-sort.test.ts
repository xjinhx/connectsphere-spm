import { describe, it, expect } from 'vitest';
import { sortBookingQueue, toBookingQueueSort } from '@/domain/venue-booking/policy';

/**
 * SCRUM-147 AC2 — "Given I sort the queue by requested event date, when the
 * list reloads, then the soonest event appears first."
 *
 * Test case IDs match the SCRUM-147 sheet of the Sprint 2 test case workbook.
 * Each case lists the requests in the order they were added (requestedAt), as
 * the sheet does, so the event-date sort has to reorder them.
 */

const entry = (lineId: string, event: string, date: string, requestedAt: string) => ({
  lineId,
  event,
  date,
  requestedAt,
});
const events = (rows: { event: string }[]) => rows.map((row) => row.event);

describe('sortBookingQueue: SCRUM-147 AC2', () => {
  it('TC-147-03: sorting by requested event date puts the soonest event first', () => {
    const queue = [
      entry('l1', 'Client Gala Dinner', '2026-12-05', '2026-09-20T02:00:00Z'),
      entry('l2', 'Annual Townhall', '2026-11-20', '2026-09-22T02:00:00Z'),
      entry('l3', 'Product Launch', '2026-10-15', '2026-09-24T02:00:00Z'),
    ];
    expect(events(sortBookingQueue(queue, 'event-date'))).toEqual([
      'Product Launch',
      'Annual Townhall',
      'Client Gala Dinner',
    ]);
  });

  it('TC-147-04: sorts by the calendar date across a year end, not the displayed text', () => {
    const queue = [
      entry('l1', 'New Year Kickoff', '2027-01-02', '2026-09-20T02:00:00Z'),
      entry('l2', 'Year-End Party', '2026-12-30', '2026-09-22T02:00:00Z'),
      entry('l3', 'Team Workshop', '2026-10-12', '2026-09-24T02:00:00Z'),
    ];
    expect(events(sortBookingQueue(queue, 'event-date'))).toEqual([
      'Team Workshop',
      'Year-End Party',
      'New Year Kickoff',
    ]);
  });

  it('defaults to the order requests arrived, oldest first', () => {
    const queue = [
      entry('l1', 'Third', '2026-10-01', '2026-09-24T02:00:00Z'),
      entry('l2', 'First', '2026-12-01', '2026-09-20T02:00:00Z'),
      entry('l3', 'Second', '2026-11-01', '2026-09-22T02:00:00Z'),
    ];
    expect(events(sortBookingQueue(queue, 'requested'))).toEqual(['First', 'Second', 'Third']);
  });

  it('breaks a tie on event date by the order requests arrived', () => {
    const queue = [
      entry('l1', 'Later request', '2026-11-20', '2026-09-24T02:00:00Z'),
      entry('l2', 'Earlier request', '2026-11-20', '2026-09-20T02:00:00Z'),
    ];
    expect(events(sortBookingQueue(queue, 'event-date'))).toEqual(['Earlier request', 'Later request']);
  });

  it('leaves the input untouched', () => {
    const queue = [entry('l1', 'B', '2026-12-01', '2026-09-20T02:00:00Z'), entry('l2', 'A', '2026-10-01', '2026-09-21T02:00:00Z')];
    sortBookingQueue(queue, 'event-date');
    expect(events(queue)).toEqual(['B', 'A']);
  });
});

describe('toBookingQueueSort', () => {
  it('reads the sort from the URL, falling back to the default', () => {
    expect(toBookingQueueSort('event-date')).toBe('event-date');
    expect(toBookingQueueSort('requested')).toBe('requested');
    expect(toBookingQueueSort(undefined)).toBe('requested');
    expect(toBookingQueueSort('nonsense')).toBe('requested');
  });
});
