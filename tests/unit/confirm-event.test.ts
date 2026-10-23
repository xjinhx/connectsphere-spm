import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * SCRUM-102 Block confirmation until essential arrangements are complete.
 *
 * The check's rules on their own (outstandingEssentialArrangements), the status
 * rule, and the route's refusals. That a refusal leaves the event in Planning,
 * and that a confirmation notifies the organiser, runs against the database in
 * tests/integration/confirm-event.test.ts.
 *
 * AC text is from the Jira card (authoritative):
 *   AC1 "Given venue is marked essential for an event and any of its venue
 *        bookings has not been approved, when I attempt to confirm the event,
 *        then confirmation is refused and the outstanding venue arrangement is
 *        named."
 *   AC2 "Given equipment is marked essential and the equipment is not fully
 *        reserved, when I attempt to confirm the event, then confirmation is
 *        refused and the outstanding equipment is named."
 *   AC3 "Given an event has venue marked essential and equipment, technical
 *        support and registration marked not required, when all of its venue
 *        bookings are approved, then confirmation succeeds with only the venue
 *        arrangement complete."
 *   AC4 "Given an event has no arrangement marked essential, when I confirm
 *        it, then confirmation succeeds."
 *   AC5 "Given an outstanding action exists that is not marked essential for
 *        the event, when I confirm the event, then confirmation succeeds and
 *        the outstanding action remains open."
 *
 * Test case IDs are from the SCRUM-102 tab of Marcus's Sprint 4 test cases
 * (TC-102-nn).
 */

vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));
vi.mock('@/domain/event-status/service', () => ({ confirmEvent: vi.fn() }));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { confirmEvent } from '@/domain/event-status/service';
import { POST } from '@/app/api/event-requests/[id]/confirm/route';
import {
  CANNOT_CONFIRM_YET,
  NO_APPROVED_BOOKING,
  NO_EQUIPMENT_REQUESTED,
  confirmationRefusal,
  outstandingEssentialArrangements,
} from '@/domain/essential-arrangements/policy';
import type { ArrangementNeeds, ConfirmationSnapshot } from '@/domain/essential-arrangements/schema';
import { canBeConfirmed } from '@/domain/event-status/policy';
import { EventRequestStatusEnum } from '@/domain/event-request/schema';
import type { Role } from '@/domain/identity/roles';
import { ForbiddenError } from '@/domain/shared/errors';

const NOTHING_ESSENTIAL: ArrangementNeeds = {
  venue: 'not_required',
  equipment: 'not_required',
  technicalSupport: 'not_required',
  registration: 'not_required',
};
const VENUE_ESSENTIAL: ArrangementNeeds = { ...NOTHING_ESSENTIAL, venue: 'essential' };
const EQUIPMENT_ESSENTIAL: ArrangementNeeds = { ...NOTHING_ESSENTIAL, equipment: 'essential' };

function snapshot(overrides: Partial<ConfirmationSnapshot>): ConfirmationSnapshot {
  return {
    needs: NOTHING_ESSENTIAL,
    venueLines: [],
    venueBookings: [],
    affectedBookings: [],
    equipment: { reservations: [], outstanding: [] },
    ...overrides,
  };
}

const line = (venueName: string, date: string, startTime: string, endTime: string, status: 'pending' | 'approved' | 'rejected') => ({
  venueName,
  date,
  startTime,
  endTime,
  status,
});
const booking = (id: string, venueName: string, date: string, status: 'confirmed' | 'released' = 'confirmed') => ({
  id,
  venueName,
  date,
  startTime: '10:00',
  endTime: '12:00',
  status,
});

const RESERVED = { status: 'reserved' as const };

describe('AC1 — an essential venue that is not complete', () => {
  it('TC-102-01: a Pending line is outstanding, naming that line', () => {
    expect(
      outstandingEssentialArrangements(
        snapshot({ needs: VENUE_ESSENTIAL, venueLines: [line('Marina Bay Ballroom', '2026-11-10', '10:00', '12:00', 'pending')] }),
      ),
    ).toEqual(['Venue: Marina Bay Ballroom, 10/11/2026, 10:00 to 12:00 is not yet approved.']);
  });

  it('TC-102-02: only the Pending line is outstanding when another booking is approved', () => {
    expect(
      outstandingEssentialArrangements(
        snapshot({
          needs: VENUE_ESSENTIAL,
          venueLines: [
            line('Bugis Seminar Room', '2026-11-10', '10:00', '12:00', 'approved'),
            line('Jurong East Training Room', '2026-11-11', '14:00', '16:00', 'pending'),
          ],
          venueBookings: [booking('b-1', 'Bugis Seminar Room', '2026-11-10')],
        }),
      ),
    ).toEqual(['Venue: Jurong East Training Room, 11/11/2026, 14:00 to 16:00 is not yet approved.']);
  });

  it('TC-102-03: with no confirmed booking the venue is outstanding; a rejected line is not counted', () => {
    expect(
      outstandingEssentialArrangements(
        snapshot({ needs: VENUE_ESSENTIAL, venueLines: [line('Marina Bay Ballroom', '2026-11-10', '10:00', '12:00', 'rejected')] }),
      ),
    ).toEqual([NO_APPROVED_BOOKING]);
  });

  it('TC-102-04: an affected booking leaves an essential venue outstanding', () => {
    expect(
      outstandingEssentialArrangements(
        snapshot({
          needs: VENUE_ESSENTIAL,
          venueBookings: [booking('b-1', 'Bugis Seminar Room', '2026-11-12')],
          affectedBookings: [{ bookingId: 'b-1' }],
        }),
      ),
    ).toEqual(['Venue: Bugis Seminar Room, 12/11/2026, 10:00 to 12:00 is affected by an unavailable period.']);
  });
});

describe('AC2 — essential equipment that is not fully reserved', () => {
  it('TC-102-05: a line not fully reserved is outstanding, naming the item and how many', () => {
    expect(
      outstandingEssentialArrangements(
        snapshot({
          needs: EQUIPMENT_ESSENTIAL,
          venueBookings: [booking('b-1', 'Marina Bay Ballroom', '2026-11-13')],
          equipment: { reservations: [RESERVED, RESERVED], outstanding: [{ equipmentName: 'EQ-102-01', outstanding: 2 }] },
        }),
      ),
    ).toEqual(['Equipment: EQ-102-01, 2 still to reserve.']);
  });

  it('TC-102-06: essential with no equipment lines is outstanding', () => {
    expect(
      outstandingEssentialArrangements(
        snapshot({ needs: EQUIPMENT_ESSENTIAL, venueBookings: [booking('b-1', 'Marina Bay Ballroom', '2026-11-13')] }),
      ),
    ).toEqual([NO_EQUIPMENT_REQUESTED]);
  });

  it('TC-102-10: every line fully reserved: equipment complete', () => {
    expect(
      outstandingEssentialArrangements(snapshot({ needs: EQUIPMENT_ESSENTIAL, equipment: { reservations: [RESERVED], outstanding: [] } })),
    ).toEqual([]);
  });
});

describe('AC2 — equipment still named when the venue is outstanding too', () => {
  it('TC-102-07: both arrangements are returned, and one refusal names both', () => {
    const outstanding = outstandingEssentialArrangements(
      snapshot({
        needs: { ...NOTHING_ESSENTIAL, venue: 'essential', equipment: 'essential' },
        venueLines: [line('Marina Bay Ballroom', '2026-11-14', '10:00', '12:00', 'pending')],
        equipment: { reservations: [], outstanding: [{ equipmentName: 'EQ-102-01', outstanding: 2 }] },
      }),
    );
    expect(outstanding).toEqual([
      'Venue: Marina Bay Ballroom, 14/11/2026, 10:00 to 12:00 is not yet approved.',
      'Equipment: EQ-102-01, 2 still to reserve.',
    ]);
    expect(confirmationRefusal(outstanding)).toBe(
      `${CANNOT_CONFIRM_YET}\n` +
        '- Venue: Marina Bay Ballroom, 14/11/2026, 10:00 to 12:00 is not yet approved.\n' +
        '- Equipment: EQ-102-01, 2 still to reserve.',
    );
  });
});

describe('AC3 — venue essential and every booking approved', () => {
  it('TC-102-08: nothing outstanding', () => {
    expect(
      outstandingEssentialArrangements(
        snapshot({
          needs: VENUE_ESSENTIAL,
          venueBookings: [booking('b-1', 'Marina Bay Ballroom', '2026-11-15'), booking('b-2', 'Bugis Seminar Room', '2026-11-16')],
        }),
      ),
    ).toEqual([]);
  });

  it('TC-102-09: a released booking is neither complete nor outstanding', () => {
    const released = booking('b-2', 'Marina Bay Ballroom', '2026-11-17', 'released');
    expect(
      outstandingEssentialArrangements(
        snapshot({ needs: VENUE_ESSENTIAL, venueBookings: [booking('b-1', 'Bugis Seminar Room', '2026-11-17'), released] }),
      ),
    ).toEqual([]);
    // On its own it does not make the venue complete.
    expect(outstandingEssentialArrangements(snapshot({ needs: VENUE_ESSENTIAL, venueBookings: [released] }))).toEqual([
      NO_APPROVED_BOOKING,
    ]);
  });
});

describe('AC4 — nothing marked essential', () => {
  it('TC-102-11: nothing is outstanding', () => {
    expect(
      outstandingEssentialArrangements(snapshot({ venueBookings: [booking('b-1', 'Marina Bay Ballroom', '2026-11-18')] })),
    ).toEqual([]);
  });
});

describe('AC5 — incomplete arrangements that are not essential', () => {
  it('TC-102-12: a Pending line and a line still to reserve do not block', () => {
    expect(
      outstandingEssentialArrangements(
        snapshot({
          venueLines: [line('Jurong East Training Room', '2026-11-18', '14:00', '16:00', 'pending')],
          equipment: { reservations: [], outstanding: [{ equipmentName: 'EQ-102-01', outstanding: 2 }] },
        }),
      ),
    ).toEqual([]);
  });

  it('TC-102-13: an affected booking does not block when venue is not essential', () => {
    expect(
      outstandingEssentialArrangements(
        snapshot({
          venueBookings: [booking('b-1', 'Bugis Seminar Room', '2026-11-19')],
          affectedBookings: [{ bookingId: 'b-1' }],
        }),
      ),
    ).toEqual([]);
  });
});

describe('Supplementary — who may confirm, and when', () => {
  it('TC-102-16: only an event in Planning can be confirmed', () => {
    for (const status of EventRequestStatusEnum.options) {
      expect(canBeConfirmed(status)).toBe(status === 'planning');
    }
  });

  const EV_1 = '11111111-1111-4111-8111-111111111111';
  const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  function signInAs(...roles: Role[]) {
    vi.mocked(getCurrentActor).mockResolvedValue({ userId: ACCOUNT, fullName: 'Test', roles, clientOrganisation: null });
  }

  const post = () =>
    POST(new NextRequest(`http://localhost/api/event-requests/${EV_1}/confirm`, { method: 'POST' }), {
      params: Promise.resolve({ id: EV_1 }),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(confirmEvent).mockResolvedValue({ id: EV_1, status: 'confirmed' });
  });

  it('passes a coordinator through, as the signed-in account', async () => {
    signInAs('coordinator');
    const response = await post();
    expect(response.status).toBe(200);
    expect(confirmEvent).toHaveBeenCalledWith(EV_1, expect.objectContaining({ userId: ACCOUNT }));
  });

  it('TC-102-17: the Event Coordinator Lead is refused with 403, before the event is read', async () => {
    signInAs('operations_manager');
    const response = await post();
    expect(response.status).toBe(403);
    expect(confirmEvent).not.toHaveBeenCalled();
  });

  it('TC-102-17: a coordinator the event is not assigned to is refused with 403', async () => {
    signInAs('coordinator');
    vi.mocked(confirmEvent).mockRejectedValue(new ForbiddenError('This event is not assigned to you.'));
    const response = await post();
    expect(response.status).toBe(403);
  });
});
