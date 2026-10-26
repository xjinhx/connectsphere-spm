import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * SCRUM-111 Flag affected arrangements and mark them for review after a
 * significant change (Jira, authoritative; absorbs SCRUM-112):
 *   AC1 a change to date, times or attendance affects an approved venue
 *       booking and needs the coordinator's acknowledgement;
 *   AC2 a change to date or times affects reserved equipment, likewise;
 *   AC3 a descriptive change affects nothing and asks nothing;
 *   AC4 no cut-off: a Confirmed event starting tomorrow can still change;
 *   AC5 an acknowledged change flags each affected arrangement with the time
 *       and the cause;
 *   AC6, AC7 the flag comes back with the booking and the reservation;
 *   AC8 none remains once every one is re-confirmed;
 *   AC9 the assigned coordinator re-confirms one; who and when are saved.
 *
 * Pure rules and the routes. Test case IDs are from the Sprint 4 sheet's
 * SCRUM-111 tab (TC-111-nn). The database half is
 * tests/integration/review-required-flag.test.ts.
 */

vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));
vi.mock('@/domain/significant-change/service', () => ({
  changeEventSchedule: vi.fn(),
  reconfirmArrangement: vi.fn(),
  getEventSchedule: vi.fn(),
}));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { changeEventSchedule, reconfirmArrangement } from '@/domain/significant-change/service';
import {
  affectedArrangements,
  changeCauses,
  changedKinds,
  eventNeedsReview,
  needsAcknowledgement,
} from '@/domain/significant-change/policy';
import { EventScheduleInputSchema, PAST_DATE_MESSAGE, type ScheduleValues } from '@/domain/significant-change/schema';
import { isActionPermitted } from '@/domain/identity/permissions';
import type { Role } from '@/domain/identity/roles';
import { todayInSingapore } from '@/domain/shared/dates';
import { UnauthenticatedError } from '@/domain/shared/errors';
import { PUT } from '@/app/api/event-requests/[id]/schedule/route';
import { POST } from '@/app/api/event-requests/[id]/arrangement-reviews/route';

const EV_1 = '11111111-1111-4111-8111-111111111111';
const COORDINATOR = '22222222-2222-4222-8222-222222222222';
const BOOKING = { id: 'booking-1', label: 'Marina Bay Ballroom, 20/11/2026, 10:00–12:00' };
const RESERVATION = { id: 'reservation-1', label: 'Projector P-100 × 2, 19/11/2026 to 20/11/2026' };

/** S111 Harbour Gala as the sheet sets it up. */
const GALA: ScheduleValues = {
  proposedDate: '2026-11-20',
  startTime: '10:00',
  endTime: '12:00',
  expectedAttendance: 150,
  roomLayout: 'banquet',
  accessibilityRequired: false,
  accessibilityNotes: null,
};
/** S111 AV Night: 19:00-22:00, attendance 80. */
const AV_NIGHT: ScheduleValues = { ...GALA, startTime: '19:00', endTime: '22:00', expectedAttendance: 80 };

const both = { bookings: [BOOKING], reservations: [RESERVATION] };

function daysFromToday(days: number): string {
  const date = new Date(`${todayInSingapore()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe('SCRUM-111 AC1, AC2, AC3: which change affects which arrangement (affectedArrangements)', () => {
  it('SCRUM-111 AC1 TC-111-01 a changed date affects the approved booking, and asks for acknowledgement', () => {
    const affected = affectedArrangements(GALA, { ...GALA, proposedDate: '2026-11-27' }, { bookings: [BOOKING], reservations: [] });
    expect(affected.bookings).toEqual([BOOKING]);
    expect(needsAcknowledgement(affected)).toBe(true);
    expect(changeCauses(GALA, { ...GALA, proposedDate: '2026-11-27' }).booking).toBe(
      'Date changed from 20/11/2026 to 27/11/2026',
    );
  });

  it('SCRUM-111 AC1 TC-111-02 a changed attendance affects the booking', () => {
    const after = { ...GALA, expectedAttendance: 180 };
    expect(affectedArrangements(GALA, after, both).bookings).toEqual([BOOKING]);
    expect(changeCauses(GALA, after).booking).toBe('Expected attendance changed from 150 to 180');
  });

  it('SCRUM-111 AC1 changed times affect the booking', () => {
    const after = { ...GALA, startTime: '14:00', endTime: '16:00' };
    expect(affectedArrangements(GALA, after, both).bookings).toEqual([BOOKING]);
    expect(changeCauses(GALA, after).booking).toBe('Times changed from 10:00–12:00 to 14:00–16:00');
  });

  it('SCRUM-111 AC2 TC-111-04 a changed end time affects the equipment reservation', () => {
    const after = { ...AV_NIGHT, endTime: '23:00' };
    const affected = affectedArrangements(AV_NIGHT, after, { bookings: [], reservations: [RESERVATION] });
    expect(affected.reservations).toEqual([RESERVATION]);
    expect(needsAcknowledgement(affected)).toBe(true);
    expect(changeCauses(AV_NIGHT, after).reservation).toBe('Times changed from 19:00–22:00 to 19:00–23:00');
  });

  it('SCRUM-111 AC2 a changed date affects the equipment reservation too', () => {
    expect(affectedArrangements(GALA, { ...GALA, proposedDate: '2026-11-27' }, both)).toEqual({
      bookings: [BOOKING],
      reservations: [RESERVATION],
    });
  });

  it('SCRUM-111 AC2 TC-111-05 an attendance-only change does not affect the equipment reservation', () => {
    const after = { ...AV_NIGHT, expectedAttendance: 90 };
    const affected = affectedArrangements(AV_NIGHT, after, { bookings: [], reservations: [RESERVATION] });
    expect(affected.reservations).toEqual([]);
    expect(needsAcknowledgement(affected)).toBe(false);
    expect(changeCauses(AV_NIGHT, after).reservation).toBeNull();
  });

  it('SCRUM-111 AC5 a changed requirement affects the booking only, naming what changed', () => {
    const after = { ...GALA, roomLayout: 'theatre' as const, accessibilityRequired: true, accessibilityNotes: 'Ramp access' };
    expect(affectedArrangements(GALA, after, both)).toEqual({ bookings: [BOOKING], reservations: [] });
    expect(changeCauses(GALA, after).booking).toBe(
      'Venue requirements changed: room layout from Banquet to Theatre; accessibility from none required to required (Ramp access)',
    );
  });

  it('SCRUM-111 AC5 several changes are named together, each arrangement with its own', () => {
    const after = { ...GALA, proposedDate: '2026-11-27', expectedAttendance: 180 };
    expect(changeCauses(GALA, after)).toEqual({
      booking: 'Date changed from 20/11/2026 to 27/11/2026; Expected attendance changed from 150 to 180',
      reservation: 'Date changed from 20/11/2026 to 27/11/2026',
    });
  });

  it('SCRUM-111 AC3 TC-111-06 an unchanged schedule affects nothing and asks nothing', () => {
    const affected = affectedArrangements(GALA, { ...GALA }, both);
    expect(affected).toEqual({ bookings: [], reservations: [] });
    expect(needsAcknowledgement(affected)).toBe(false);
    expect(changedKinds(GALA, { ...GALA })).toEqual([]);
  });

  it('SCRUM-111 AC3 accessibility notes without a "yes" are not a change (they are never stored)', () => {
    expect(changedKinds(GALA, { ...GALA, accessibilityNotes: 'ignored' })).toEqual([]);
  });
});

describe('SCRUM-111 AC8: an event needs review while any arrangement is flagged (eventNeedsReview)', () => {
  it('SCRUM-111 AC8 TC-111-13 one of two re-confirmed: the event still needs review', () => {
    expect(eventNeedsReview([{ reviewRequired: false }, { reviewRequired: true }])).toBe(true);
  });

  it('SCRUM-111 AC8 TC-111-14 every one re-confirmed: no flag remains', () => {
    expect(eventNeedsReview([{ reviewRequired: false }, { reviewRequired: false }])).toBe(false);
    expect(eventNeedsReview([])).toBe(false);
  });
});

describe('SCRUM-111: the change as entered (EventScheduleInputSchema)', () => {
  const valid = {
    proposedDate: daysFromToday(30),
    startTime: '10:00',
    endTime: '12:00',
    expectedAttendance: 150,
    roomLayout: '',
    accessibilityRequired: null,
    accessibilityNotes: '',
  };

  it('accepts a change, reading a missing acknowledgement as not given', () => {
    const parsed = EventScheduleInputSchema.parse(valid);
    expect(parsed.acknowledged).toBe(false);
    expect(parsed.roomLayout).toBeUndefined();
  });

  it('SCRUM-111 AC4 TC-111-07 accepts a date of tomorrow: there is no cut-off', () => {
    expect(EventScheduleInputSchema.safeParse({ ...valid, proposedDate: daysFromToday(1), startTime: '14:00', endTime: '16:00' }).success).toBe(true);
  });

  it('refuses a date already past, naming the date', () => {
    const result = EventScheduleInputSchema.safeParse({ ...valid, proposedDate: daysFromToday(-1) });
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.proposedDate).toEqual([PAST_DATE_MESSAGE]);
  });

  it('refuses an end not after the start, naming both times', () => {
    const result = EventScheduleInputSchema.safeParse({ ...valid, startTime: '12:00', endTime: '10:00' });
    expect(result.success).toBe(false);
    expect(Object.keys(result.error?.flatten().fieldErrors ?? {})).toEqual(['startTime', 'endTime']);
  });

  it('refuses a time off the 15-minute unit and an attendance of 0', () => {
    expect(EventScheduleInputSchema.safeParse({ ...valid, startTime: '10:10' }).success).toBe(false);
    expect(EventScheduleInputSchema.safeParse({ ...valid, expectedAttendance: 0 }).success).toBe(false);
  });
});

describe('SCRUM-111: who may change and re-confirm (event_schedule_change)', () => {
  it('SCRUM-111 AC1 AC9 gives the permission to coordinators only', () => {
    expect(isActionPermitted(['coordinator'], 'event_schedule_change')).toBe(true);
    for (const role of ['event_organiser', 'operations_manager', 'venue_staff', 'technical_support', 'attendee', 'safety_officer'] as Role[]) {
      expect(isActionPermitted([role], 'event_schedule_change')).toBe(false);
    }
  });
});

const NON_COORDINATORS: Role[] = ['event_organiser', 'operations_manager', 'venue_staff', 'technical_support', 'attendee', 'safety_officer'];

function signInAs(...roles: Role[]) {
  vi.mocked(getCurrentActor).mockResolvedValue({ userId: COORDINATOR, fullName: 'Test', roles, clientOrganisation: null });
}

describe('SCRUM-111: PUT /api/event-requests/[id]/schedule', () => {
  const body = { proposedDate: '2026-11-27', startTime: '10:00', endTime: '12:00', expectedAttendance: 150, acknowledged: true };
  const put = (payload: unknown) =>
    PUT(
      new NextRequest(`http://localhost/api/event-requests/${EV_1}/schedule`, { method: 'PUT', body: JSON.stringify(payload) }),
      { params: Promise.resolve({ id: EV_1 }) },
    );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(changeEventSchedule).mockResolvedValue({ values: GALA, flaggedBookings: 1, flaggedReservations: 0 });
  });

  it('SCRUM-111 AC5 passes a coordinator through, with the signed-in account as the one changing it', async () => {
    signInAs('coordinator');
    const response = await put(body);
    expect(response.status).toBe(200);
    expect(changeEventSchedule).toHaveBeenCalledWith(EV_1, COORDINATOR, body);
  });

  it.each(NON_COORDINATORS)('refuses %s with 403, and nothing is saved', async (role) => {
    signInAs(role);
    expect((await put(body)).status).toBe(403);
    expect(changeEventSchedule).not.toHaveBeenCalled();
  });

  it('refuses no session with 401', async () => {
    vi.mocked(getCurrentActor).mockRejectedValue(new UnauthenticatedError());
    expect((await put(body)).status).toBe(401);
    expect(changeEventSchedule).not.toHaveBeenCalled();
  });
});

describe('SCRUM-111: POST /api/event-requests/[id]/arrangement-reviews', () => {
  const body = { kind: 'venue_booking', id: '33333333-3333-4333-8333-333333333333' };
  const post = (payload: unknown) =>
    POST(
      new NextRequest(`http://localhost/api/event-requests/${EV_1}/arrangement-reviews`, { method: 'POST', body: JSON.stringify(payload) }),
      { params: Promise.resolve({ id: EV_1 }) },
    );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('SCRUM-111 AC9 TC-111-11 passes a coordinator through, as the one re-confirming', async () => {
    signInAs('coordinator');
    vi.mocked(reconfirmArrangement).mockResolvedValue({
      kind: 'venue_booking',
      id: body.id,
      label: BOOKING.label,
      reviewRequired: false,
      reviewRequiredAt: '2026-10-24T10:00:00Z',
      reviewRequiredCause: 'Date changed from 20/11/2026 to 27/11/2026',
      reconfirmedAt: '2026-10-24T11:00:00Z',
      reconfirmedByName: 'Coordinator A',
    });
    const response = await post(body);
    expect(response.status).toBe(200);
    expect(reconfirmArrangement).toHaveBeenCalledWith(EV_1, COORDINATOR, body);
  });

  it.each(NON_COORDINATORS)('SCRUM-111 AC9 refuses %s with 403', async (role) => {
    signInAs(role);
    expect((await post(body)).status).toBe(403);
    expect(reconfirmArrangement).not.toHaveBeenCalled();
  });
});
