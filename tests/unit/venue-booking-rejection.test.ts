import { describe, it, expect } from 'vitest';
import { canViewBookingRequest, requestStatusOf } from '@/domain/venue-booking/policy';
import { DecideVenueBookingRequestInputSchema } from '@/domain/venue-booking/schema';

/**
 * SCRUM-149 Reject a booking request with a reason (Jira, authoritative).
 * AC1: rejecting a pending request with a reason makes it Rejected. AC2: no
 * reason, no rejection. AC3: the coordinator sees the reason and who decided.
 *
 * A rejection is SCRUM-148's decision with every line rejected, so these check
 * that decision's rules from SCRUM-149's side, by test case.
 */

const LINE = '33333333-3333-4333-8333-333333333333';

function rejectionMessage(reason: string): string | undefined {
  const result = DecideVenueBookingRequestInputSchema.safeParse({ decisions: [{ lineId: LINE, decision: 'reject', reason }] });
  return result.success ? undefined : result.error.issues[0]?.message;
}

describe('rejecting with a reason (AC1, AC2)', () => {
  it('makes a request whose only line is rejected Rejected (TC-149-01)', () => {
    expect(requestStatusOf(['rejected'])).toBe('rejected');
  });

  it('refuses an empty reason (TC-149-03)', () => {
    expect(rejectionMessage('')).toBe('A reason is required for each rejected line.');
  });

  it('treats a reason of only spaces as empty (TC-149-04)', () => {
    expect(rejectionMessage('   ')).toBe('A reason is required for each rejected line.');
  });

  it('accepts a one-character reason (TC-149-05)', () => {
    expect(rejectionMessage('X')).toBeUndefined();
  });
});

describe('canViewBookingRequest (AC3)', () => {
  const COORDINATOR = '11111111-1111-4111-8111-111111111111';
  const OTHER = '22222222-2222-4222-8222-222222222222';

  it("lets the event's assigned coordinator open it", () => {
    expect(canViewBookingRequest({ userId: COORDINATOR, roles: ['coordinator'] }, COORDINATOR)).toBe(true);
  });

  it('lets Venue Staff open it', () => {
    expect(canViewBookingRequest({ userId: OTHER, roles: ['venue_staff'] }, COORDINATOR)).toBe(true);
  });

  it('refuses a coordinator who is not assigned to the event', () => {
    expect(canViewBookingRequest({ userId: OTHER, roles: ['coordinator'] }, COORDINATOR)).toBe(false);
  });

  it('refuses an Event Operations Manager, as the card names only the coordinator', () => {
    expect(canViewBookingRequest({ userId: OTHER, roles: ['operations_manager'] }, COORDINATOR)).toBe(false);
  });
});
