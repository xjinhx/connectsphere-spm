import { describe, it, expect } from 'vitest';
import { bookingDecisionMessage, canSeeBookingDetails, requestStatusOf } from '@/domain/venue-booking/policy';
import { DecideVenueBookingRequestInputSchema, VenueBookingRangeSchema } from '@/domain/venue-booking/schema';

/**
 * SCRUM-148 Approve a booking request (Jira, authoritative).
 * AC1: approved request records who decided and when. AC3/AC4: who sees a
 * booking's event on the venue calendar. AC5: lines decided one by one, a mix
 * makes the request Partially Approved, each rejected line carries a reason.
 */

describe('requestStatusOf (AC1, AC5)', () => {
  it('is Pending while any line is undecided', () => {
    expect(requestStatusOf(['approved', 'pending'])).toBe('pending');
  });

  it('is Approved when every line is approved (AC1)', () => {
    expect(requestStatusOf(['approved', 'approved', 'approved'])).toBe('approved');
  });

  it('is Partially Approved when lines were approved and rejected (AC5)', () => {
    expect(requestStatusOf(['approved', 'approved', 'rejected'])).toBe('partially_approved');
  });

  it('is Rejected when every line is rejected', () => {
    expect(requestStatusOf(['rejected', 'rejected'])).toBe('rejected');
  });
});

describe('canSeeBookingDetails (AC3, AC4)', () => {
  const COORDINATOR = '11111111-1111-4111-8111-111111111111';
  const OTHER = '22222222-2222-4222-8222-222222222222';

  it('shows the event to Venue Staff (AC3)', () => {
    expect(canSeeBookingDetails({ userId: OTHER, roles: ['venue_staff'] }, COORDINATOR)).toBe(true);
  });

  it('shows the event to an Event Operations Manager (AC3)', () => {
    expect(canSeeBookingDetails({ userId: OTHER, roles: ['operations_manager'] }, COORDINATOR)).toBe(true);
  });

  it("shows the event to the event's assigned coordinator (AC3)", () => {
    expect(canSeeBookingDetails({ userId: COORDINATOR, roles: ['coordinator'] }, COORDINATOR)).toBe(true);
  });

  it('hides it from a coordinator not assigned to the event (AC4)', () => {
    expect(canSeeBookingDetails({ userId: OTHER, roles: ['coordinator'] }, COORDINATOR)).toBe(false);
  });

  it('hides it from Technical Support Staff (AC4)', () => {
    expect(canSeeBookingDetails({ userId: OTHER, roles: ['technical_support'] }, COORDINATOR)).toBe(false);
  });
});

describe('DecideVenueBookingRequestInputSchema (AC5)', () => {
  const LINE_A = '33333333-3333-4333-8333-333333333333';
  const LINE_B = '44444444-4444-4444-8444-444444444444';

  function firstMessage(input: unknown): string | undefined {
    const result = DecideVenueBookingRequestInputSchema.safeParse(input);
    return result.success ? undefined : result.error.issues[0]?.message;
  }

  it('accepts an approval and a rejection with a reason', () => {
    expect(
      DecideVenueBookingRequestInputSchema.safeParse({
        decisions: [
          { lineId: LINE_A, decision: 'approve' },
          { lineId: LINE_B, decision: 'reject', reason: 'No security staff after 10pm' },
        ],
      }).success,
    ).toBe(true);
  });

  it('refuses a rejected line without a reason', () => {
    expect(firstMessage({ decisions: [{ lineId: LINE_A, decision: 'reject', reason: '   ' }] })).toBe(
      'A reason is required for each rejected line.',
    );
  });

  it('refuses the same line decided twice', () => {
    expect(
      firstMessage({ decisions: [{ lineId: LINE_A, decision: 'approve' }, { lineId: LINE_A, decision: 'approve' }] }),
    ).toBe('Each line can only be decided once.');
  });

  it('refuses an empty decision', () => {
    expect(firstMessage({ decisions: [] })).toBe('Decide at least one line.');
  });
});

describe('VenueBookingRangeSchema (AC3, AC4)', () => {
  it('accepts a range of whole days', () => {
    expect(VenueBookingRangeSchema.safeParse({ from: '2026-10-15', to: '2026-10-16' }).success).toBe(true);
  });

  it('refuses a range that ends before it starts', () => {
    expect(VenueBookingRangeSchema.safeParse({ from: '2026-10-16', to: '2026-10-15' }).success).toBe(false);
  });
});

describe('bookingDecisionMessage (AC2), in exact times since SCRUM-239', () => {
  const PERIODS = { am: ['07:00', '12:00'], night: ['19:00', '24:00'] } as const;
  const line = (date: string, slot: keyof typeof PERIODS, status: 'approved' | 'rejected', reason: string | null = null) => ({
    date,
    start: PERIODS[slot][0],
    end: PERIODS[slot][1],
    status,
    rejectionReason: reason,
  });

  it('tells the coordinator an approved request was approved', () => {
    expect(bookingDecisionMessage('Bugis Seminar Room', { status: 'approved', lines: [line('2026-10-26', 'am', 'approved')] })).toBe(
      'Your booking request for Bugis Seminar Room was approved: 26 Oct 2026 07:00–12:00.',
    );
  });

  it('names each rejected line and its reason when the request is partly approved', () => {
    expect(
      bookingDecisionMessage('Marina Bay Ballroom', {
        status: 'partially_approved',
        lines: [line('2026-10-28', 'am', 'approved'), line('2026-10-28', 'night', 'rejected', 'No security staff after 10pm')],
      }),
    ).toBe(
      'Your booking request for Marina Bay Ballroom was partially approved. Approved: 28 Oct 2026 07:00–12:00. Rejected: 28 Oct 2026 19:00–24:00 (No security staff after 10pm).',
    );
  });

  it('gives the reason when the whole request is rejected', () => {
    expect(
      bookingDecisionMessage('Jurong East Training Room', {
        status: 'rejected',
        lines: [line('2026-10-30', 'am', 'rejected', 'Venue under maintenance')],
      }),
    ).toBe('Your booking request for Jurong East Training Room was rejected: 30 Oct 2026 07:00–12:00 (Venue under maintenance).');
  });
});
