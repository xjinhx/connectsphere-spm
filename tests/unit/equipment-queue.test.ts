import { describe, expect, it } from 'vitest';
import {
  countUnavailableItems,
  daysUntilEvent,
  isOutstandingEquipmentRequest,
  sortEquipmentQueue,
  toEquipmentQueueSort,
} from '@/domain/equipment-request/policy';

/**
 * SCRUM-164 Queue of equipment requests awaiting review — the rules on their
 * own. What only the database can show (the stored rows read back, a status
 * changed by hand) is in tests/integration/equipment-queue.test.ts.
 *
 * AC text is from the Jira card (authoritative):
 *   AC2 "Given I sort the queue by event date, when the list reloads, then the
 *        soonest event appears first."
 *   AC3 "Given an equipment request has status fulfilled or unable to fulfil,
 *        when I open the queue, then it no longer appears as outstanding."
 *   AC4 "Given an equipment request has status partially fulfilled with at
 *        least one unavailable item, when I open the queue, then it remains
 *        listed as outstanding and shows how many items are still
 *        unavailable."
 *
 * Test case IDs are from the SCRUM-164 tab (TC-164-nn). Each case lists the
 * requests in the order they were raised, as Fixture F does (A, C, B), so the
 * event-date sort has to reorder them.
 */

const entry = (eventRequestId: string, eventDate: string | null, raisedAt: string) => ({
  eventRequestId,
  eventDate,
  raisedAt,
});
const ids = (rows: { eventRequestId: string }[]) => rows.map((row) => row.eventRequestId);

const EVT_A = entry('evt-a', '2026-11-05', '2026-10-01T02:00:00Z');
const EVT_C = entry('evt-c', '2026-11-12', '2026-10-02T02:00:00Z');
const EVT_B = entry('evt-b', '2026-10-28', '2026-10-03T02:00:00Z');

describe('sortEquipmentQueue: SCRUM-164 AC2', () => {
  it('TC-164-04 sorting by event date puts the soonest event first', () => {
    expect(ids(sortEquipmentQueue([EVT_A, EVT_C, EVT_B], 'event-date'))).toEqual(['evt-b', 'evt-a', 'evt-c']);
  });

  it('TC-164-05 sorts by the date itself across a month and year boundary, not by its text', () => {
    const evtG = entry('evt-g', '2027-01-03', '2026-10-04T02:00:00Z');
    const evtH = entry('evt-h', '2026-12-28', '2026-10-05T02:00:00Z');
    expect(ids(sortEquipmentQueue([EVT_A, EVT_C, EVT_B, evtG, evtH], 'event-date'))).toEqual([
      'evt-b',
      'evt-a',
      'evt-c',
      'evt-h',
      'evt-g',
    ]);
  });

  it('TC-164-06 does not order by when the request was raised once sorted by event date', () => {
    // A was raised before B, but B's event is sooner.
    const sorted = ids(sortEquipmentQueue([EVT_A, EVT_B], 'event-date'));
    expect(sorted.indexOf('evt-b')).toBeLessThan(sorted.indexOf('evt-a'));
    // The default order is the order they were raised.
    expect(ids(sortEquipmentQueue([EVT_B, EVT_C, EVT_A], 'raised'))).toEqual(['evt-a', 'evt-c', 'evt-b']);
  });

  it('puts an event with no date yet after every dated event', () => {
    const undated = entry('evt-x', null, '2026-09-01T02:00:00Z');
    expect(ids(sortEquipmentQueue([undated, EVT_A, EVT_B], 'event-date'))).toEqual(['evt-b', 'evt-a', 'evt-x']);
  });

  it('breaks a same-date tie by the order the requests were raised', () => {
    const later = entry('evt-later', '2026-11-05', '2026-10-09T02:00:00Z');
    expect(ids(sortEquipmentQueue([later, EVT_A], 'event-date'))).toEqual(['evt-a', 'evt-later']);
  });

  it('does not reorder the array it is given', () => {
    const queue = [EVT_A, EVT_C, EVT_B];
    sortEquipmentQueue(queue, 'event-date');
    expect(ids(queue)).toEqual(['evt-a', 'evt-c', 'evt-b']);
  });

  it('reads the sort from the URL, defaulting to the order raised', () => {
    expect(toEquipmentQueueSort('event-date')).toBe('event-date');
    expect(toEquipmentQueueSort('raised')).toBe('raised');
    expect(toEquipmentQueueSort(undefined)).toBe('raised');
    expect(toEquipmentQueueSort('nonsense')).toBe('raised');
  });
});

describe('isOutstandingEquipmentRequest: SCRUM-164 AC1, AC3, AC4', () => {
  it('TC-164-07 a fulfilled request is not outstanding', () => {
    expect(isOutstandingEquipmentRequest('fulfilled')).toBe(false);
  });

  it('TC-164-08 an unable-to-fulfil request is not outstanding, though nothing was supplied', () => {
    expect(isOutstandingEquipmentRequest('unable_to_fulfil')).toBe(false);
  });

  it('TC-164-10 a partially fulfilled request stays outstanding', () => {
    expect(isOutstandingEquipmentRequest('partially_fulfilled')).toBe(true);
  });

  it('TC-164-01 a request still under review is outstanding', () => {
    expect(isOutstandingEquipmentRequest('under_review')).toBe(true);
  });
});

describe('countUnavailableItems: SCRUM-164 AC4', () => {
  // EVT-C: Projector x1 reserved, Mic x2 unavailable, Lectern x1 unavailable.
  const projector = { quantity: 1, unavailable: false };
  const mic = { quantity: 2, unavailable: true };
  const lectern = { quantity: 1, unavailable: true };

  it('TC-164-10 counts each unavailable item once: 2, not 3 items requested and not 3 units', () => {
    expect(countUnavailableItems([projector, mic, lectern])).toBe(2);
  });

  it('TC-164-11 one unavailable item counts as 1', () => {
    expect(countUnavailableItems([projector, { ...mic, unavailable: false }, lectern])).toBe(1);
  });

  it('TC-164-09 no unavailable item counts as 0', () => {
    expect(countUnavailableItems([projector])).toBe(0);
  });
});

describe('daysUntilEvent', () => {
  it('counts calendar days from today, across a month end', () => {
    expect(daysUntilEvent('2026-10-18', '2026-10-18')).toBe(0);
    expect(daysUntilEvent('2026-10-19', '2026-10-18')).toBe(1);
    expect(daysUntilEvent('2026-11-05', '2026-10-28')).toBe(8);
    expect(daysUntilEvent('2026-10-17', '2026-10-18')).toBe(-1);
  });

  it('is null for an event with no date', () => {
    expect(daysUntilEvent(null, '2026-10-18')).toBeNull();
  });
});
