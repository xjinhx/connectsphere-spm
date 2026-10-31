import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * SCRUM-105 Cancel an event at any stage.
 *
 * The rules on their own (which statuses, the reason, who is told what) and the
 * route's refusals. That the database cancels, releases and refuses the same
 * events, and that each person is told once, runs against it in
 * tests/integration/cancel-event.test.ts.
 *
 * AC text is from the Jira card:
 *   AC1 "Given I am the assigned coordinator for an event in any status, when I
 *        cancel it and enter a reason, then the status becomes Cancelled and
 *        the reason, my name and the timestamp are recorded."
 *   AC2 "Given I am not the assigned coordinator for the event, including an
 *        Event Coordinator Lead, when I invoke a cancel action on it, then the
 *        action is refused and the status is unchanged."
 *   AC4 "... the responsible Event Organiser, the staff who actioned each
 *        affected arrangement and every attendee with an active registration
 *        are notified that it will not take place."
 *   AC6 "... Venue Staff are notified that those times are free."
 *
 * Test case IDs are from the SCRUM-105 tab of Marcus's Sprint 4 test cases
 * (TC-105-nn).
 */

vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));
vi.mock('@/domain/event-status/service', () => ({ cancelEvent: vi.fn() }));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { cancelEvent } from '@/domain/event-status/service';
import { POST } from '@/app/api/event-requests/[id]/cancel/route';
import {
  canBeCancelled,
  cancellationNotices,
  cancellationStatusRefusal,
  formatCancelledAt,
  type CancelledArrangements,
} from '@/domain/event-status/policy';
import { CANCELLATION_REASON_REQUIRED, CancelEventInputSchema } from '@/domain/event-status/schema';
import type { Role } from '@/domain/identity/roles';
import { ForbiddenError } from '@/domain/shared/errors';

const ORGANISER = 'organiser';
const VENUE_STAFF = 'venue-staff';
const TECH_SUPPORT = 'tech-support';
const ATTENDEE = 'attendee';
const EVENT = { name: 'E105-A', reference: 'EVT-2026-0105', reason: 'Client called off the event' };

const NOTHING: CancelledArrangements = { organiserId: ORGANISER, bookings: [], reservations: [], attendeeIds: [] };
const ARRANGED: CancelledArrangements = {
  organiserId: ORGANISER,
  bookings: [
    { venueName: 'Marina Bay Ballroom', date: '2026-11-12', startTime: '10:00', endTime: '12:00', approvedBy: VENUE_STAFF },
    { venueName: 'Bugis Seminar Room', date: '2026-11-13', startTime: '10:00', endTime: '12:00', approvedBy: VENUE_STAFF },
  ],
  reservations: [{ equipmentName: 'EQ-105-01', quantity: 3, reservedBy: TECH_SUPPORT }],
  attendeeIds: [ATTENDEE],
};

const messageFor = (notices: { recipientId: string; message: string }[], recipientId: string) =>
  notices.find((notice) => notice.recipientId === recipientId)?.message;

describe('AC1 — an event in any status, with a reason', () => {
  it('TC-105-01: a Planning event can be cancelled, with a reason', () => {
    expect(canBeCancelled('planning')).toBe(true);
    expect(CancelEventInputSchema.parse({ reason: '  Client called off the event ' })).toEqual({
      reason: 'Client called off the event',
    });
  });

  it('TC-105-02 / TC-105-03: from Submitted (the earliest stage) to Preparation (the latest)', () => {
    for (const status of ['submitted', 'clarification_requested', 'approved', 'planning', 'confirmed', 'preparation'] as const) {
      expect(canBeCancelled(status), status).toBe(true);
    }
  });

  it('TC-105-04: no reason, or one of only spaces, is refused, naming the reason', () => {
    for (const input of [{ reason: '' }, { reason: '   ' }, {}]) {
      const parsed = CancelEventInputSchema.safeParse(input);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toBe(CANCELLATION_REASON_REQUIRED);
    }
  });

  it('TC-105-05: Completed, Rejected and Cancelled are final, and a Draft has no coordinator', () => {
    for (const status of ['completed', 'rejected', 'cancelled', 'draft'] as const) {
      expect(canBeCancelled(status), status).toBe(false);
    }
    expect(cancellationStatusRefusal('completed')).toBe('This event is Completed and cannot be cancelled.');
  });

  it('TC-105-01: the time is shown as DD/MM/YYYY HH:mm in Singapore', () => {
    expect(formatCancelledAt('2026-10-30T06:05:00Z')).toBe('30/10/2026 14:05');
  });
});

describe('AC4, AC6 — who is told, and what', () => {
  it('TC-105-12: the organiser is told it will not take place, with the reason', () => {
    expect(messageFor(cancellationNotices(EVENT, ARRANGED), ORGANISER)).toBe(
      'E105-A (EVT-2026-0105) has been cancelled and will not take place. Reason: Client called off the event',
    );
  });

  it('TC-105-13: the Venue Staff who approved and the Technical Support Staff who reserved get one notification each', () => {
    const notices = cancellationNotices(EVENT, ARRANGED);
    expect(notices.filter((notice) => notice.recipientId === VENUE_STAFF)).toHaveLength(1);
    expect(notices.filter((notice) => notice.recipientId === TECH_SUPPORT)).toHaveLength(1);
    expect(messageFor(notices, TECH_SUPPORT)).toBe(
      'E105-A (EVT-2026-0105) has been cancelled and will not take place. Its equipment reservations are released: EQ-105-01 × 3.',
    );
  });

  it('TC-105-14: an attendee with an active registration is told it will not take place', () => {
    expect(messageFor(cancellationNotices(EVENT, ARRANGED), ATTENDEE)).toBe(
      'E105-A (EVT-2026-0105) has been cancelled and will not take place.',
    );
  });

  it('TC-105-15: with nothing arranged, only the organiser is told', () => {
    expect(cancellationNotices(EVENT, NOTHING).map((notice) => notice.recipientId)).toEqual([ORGANISER]);
  });

  it('TC-105-18: the Venue Staff are told which venue times are free', () => {
    expect(messageFor(cancellationNotices(EVENT, ARRANGED), VENUE_STAFF)).toBe(
      'E105-A (EVT-2026-0105) has been cancelled and will not take place. These venue times are free again: ' +
        'Marina Bay Ballroom, 12/11/2026, 10:00 to 12:00; Bugis Seminar Room, 13/11/2026, 10:00 to 12:00.',
    );
  });

  it('someone in two groups gets one notification with both parts', () => {
    const notices = cancellationNotices(EVENT, {
      ...ARRANGED,
      reservations: [{ equipmentName: 'EQ-105-01', quantity: 3, reservedBy: VENUE_STAFF }],
    });
    const forStaff = notices.filter((notice) => notice.recipientId === VENUE_STAFF);
    expect(forStaff).toHaveLength(1);
    expect(forStaff[0]?.message).toContain('These venue times are free again');
    expect(forStaff[0]?.message).toContain('Its equipment reservations are released');
  });
});

describe('AC2 — anyone but the assigned coordinator is refused', () => {
  const EV_1 = '11111111-1111-4111-8111-111111111111';
  const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  function signInAs(...roles: Role[]) {
    vi.mocked(getCurrentActor).mockResolvedValue({ userId: ACCOUNT, fullName: 'Test', roles, clientOrganisation: null });
  }

  const post = (body: unknown = { reason: 'Client called off the event' }) =>
    POST(
      new NextRequest(`http://localhost/api/event-requests/${EV_1}/cancel`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: EV_1 }) },
    );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cancelEvent).mockResolvedValue({ id: EV_1, status: 'cancelled' });
  });

  it('passes a coordinator and the reason through, as the signed-in account', async () => {
    signInAs('coordinator');
    const response = await post();
    expect(response.status).toBe(200);
    expect(cancelEvent).toHaveBeenCalledWith(
      EV_1,
      expect.objectContaining({ userId: ACCOUNT }),
      { reason: 'Client called off the event' },
    );
  });

  it('TC-105-06: a coordinator who is not assigned is refused with 403', async () => {
    signInAs('coordinator');
    vi.mocked(cancelEvent).mockRejectedValue(new ForbiddenError('Only the coordinator assigned to this event can cancel it.'));
    const response = await post();
    expect(response.status).toBe(403);
  });

  it('TC-105-07: the Event Coordinator Lead is refused with 403, before the event is read', async () => {
    signInAs('operations_manager');
    const response = await post();
    expect(response.status).toBe(403);
    expect(cancelEvent).not.toHaveBeenCalled();
  });

  it.each([['event_organiser'], ['venue_staff'], ['technical_support'], ['attendee'], ['safety_officer']] as const)(
    'refuses %s with 403',
    async (role) => {
      signInAs(role);
      const response = await post();
      expect(response.status).toBe(403);
      expect(cancelEvent).not.toHaveBeenCalled();
    },
  );
});
