import { describe, expect, it } from 'vitest';
import { countUnavailableItems, isOutstandingEquipmentRequest } from '@/domain/equipment-request/policy';

/**
 * SCRUM-164 Queue of equipment requests awaiting review — the rules on their
 * own. What only the database can show (the stored rows read back, a status
 * changed by hand) is in tests/integration/equipment-queue.test.ts.
 *
 * AC text is from the Jira card (authoritative):
 *   AC3 "Given an equipment request has status fulfilled or unable to fulfil,
 *        when I open the queue, then it no longer appears as outstanding."
 *   AC4 "Given an equipment request has status partially fulfilled with at
 *        least one unavailable item, when I open the queue, then it remains
 *        listed as outstanding and shows how many items are still
 *        unavailable."
 *
 * Test case IDs are from the SCRUM-164 tab (TC-164-nn).
 */

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
