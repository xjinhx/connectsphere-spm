import { describe, it, expect } from 'vitest';
import { canCreateBookingRequest, canRequestReplacement } from '@/domain/venue-booking/policy';
import { replacesBookingIdOf } from '@/domain/venue-booking/schema';
import type { EventRequestStatus } from '@/domain/event-request/schema';

/**
 * SCRUM-229 Request a replacement venue for an affected booking (Jira,
 * authoritative). AC2 and the PO decision of 12 Oct 2026: a Confirmed event
 * may request a venue only as a replacement; ordinary requests keep SCRUM-142's
 * Approved or Planning rule.
 *
 * Submitting, approving and the release run against the database in
 * tests/integration/replacement-request.test.ts.
 */

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';

describe('which events may request a replacement (AC2)', () => {
  it.each<[EventRequestStatus, boolean]>([
    ['approved', true],
    ['planning', true],
    ['confirmed', true],
    ['draft', false],
    ['submitted', false],
    ['rejected', false],
    ['completed', false],
    ['cancelled', false],
  ])('%s: %s', (status, allowed) => {
    expect(canRequestReplacement(status)).toBe(allowed);
  });

  it('leaves ordinary requests on SCRUM-142\'s rule: not while Confirmed (TC-229-03)', () => {
    expect(canCreateBookingRequest('confirmed')).toBe(false);
  });
});

describe('replacesBookingIdOf: is this a replacement request?', () => {
  it('reads the booking a replacement names (TC-229-02)', () => {
    expect(replacesBookingIdOf({ venueId: 'x', lines: [], replacesBookingId: BOOKING_ID })).toBe(BOOKING_ID);
  });

  it('is null for an ordinary request, an empty value or a malformed id', () => {
    expect(replacesBookingIdOf({ venueId: 'x', lines: [] })).toBeNull();
    expect(replacesBookingIdOf({ replacesBookingId: '' })).toBeNull();
    expect(replacesBookingIdOf({ replacesBookingId: 'not-an-id' })).toBeNull();
    expect(replacesBookingIdOf(null)).toBeNull();
  });
});
