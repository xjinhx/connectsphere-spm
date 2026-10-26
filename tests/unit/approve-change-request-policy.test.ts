import { describe, expect, it } from 'vitest';
import {
  canDecideChangeRequestFor,
  changeRequestArrangementCauses,
  changeRequestIsSignificant,
  type ChangeRequestExtras,
} from '@/domain/change-request/policy';
import { outstandingReviewArrangements } from '@/domain/essential-arrangements/policy';
import type { ScheduleValues } from '@/domain/significant-change/schema';

/**
 * SCRUM-190 — Approve a change request and apply it (Jira, authoritative).
 * The pure rules, with no database: which staff may decide a request, which
 * approved change counts as "significant" (AC2), which arrangements it
 * affects (AC4), and which flagged arrangement blocks re-confirmation (AC2,
 * AC3). Applying a decision runs against the database in
 * tests/integration/approve-change-request.test.ts.
 */

const BASE_SCHEDULE: ScheduleValues = {
  proposedDate: '2027-03-15',
  startTime: '10:00',
  endTime: '12:00',
  expectedAttendance: 150,
  roomLayout: 'banquet',
  accessibilityRequired: false,
  accessibilityNotes: null,
};

const BASE_EXTRAS: ChangeRequestExtras = {
  preferredLocationId: 'location-a',
  accessibilityFeatureIds: ['feature-1'],
  equipmentRequired: false,
  equipmentItems: [{ item: 'Projector', quantity: 2 }],
  technicalSupportNotes: null,
};

describe('canDecideChangeRequestFor (AC1)', () => {
  it('allows the event\'s assigned coordinator', () => {
    expect(canDecideChangeRequestFor({ coordinatorId: 'coordinator-a' }, 'coordinator-a')).toBe(true);
  });

  it('refuses anyone else, including no coordinator assigned', () => {
    expect(canDecideChangeRequestFor({ coordinatorId: 'coordinator-a' }, 'coordinator-b')).toBe(false);
    expect(canDecideChangeRequestFor({ coordinatorId: null }, 'coordinator-a')).toBe(false);
  });
});

describe('changeRequestIsSignificant (AC2 TC-190-02, boundary TC-190-07)', () => {
  it('TC-190-07 a purely descriptive change is not significant', () => {
    expect(changeRequestIsSignificant({ ...BASE_SCHEDULE, ...BASE_EXTRAS }, { ...BASE_SCHEDULE, ...BASE_EXTRAS })).toBe(false);
  });

  it('TC-190-02 a date change is significant', () => {
    const after = { ...BASE_SCHEDULE, proposedDate: '2027-03-22' };
    expect(changeRequestIsSignificant({ ...BASE_SCHEDULE, ...BASE_EXTRAS }, { ...after, ...BASE_EXTRAS })).toBe(true);
  });

  it('times, attendance and venue requirements (room layout/accessibility) are significant, reusing SCRUM-111\'s own taxonomy', () => {
    expect(
      changeRequestIsSignificant(
        { ...BASE_SCHEDULE, ...BASE_EXTRAS },
        { ...BASE_SCHEDULE, startTime: '14:00', endTime: '16:00', ...BASE_EXTRAS },
      ),
    ).toBe(true);
    expect(
      changeRequestIsSignificant({ ...BASE_SCHEDULE, ...BASE_EXTRAS }, { ...BASE_SCHEDULE, expectedAttendance: 200, ...BASE_EXTRAS }),
    ).toBe(true);
    expect(
      changeRequestIsSignificant(
        { ...BASE_SCHEDULE, ...BASE_EXTRAS },
        { ...BASE_SCHEDULE, roomLayout: 'theatre', ...BASE_EXTRAS },
      ),
    ).toBe(true);
  });

  it('a different preferred location is a venue-requirements change', () => {
    expect(
      changeRequestIsSignificant(
        { ...BASE_SCHEDULE, ...BASE_EXTRAS },
        { ...BASE_SCHEDULE, ...BASE_EXTRAS, preferredLocationId: 'location-b' },
      ),
    ).toBe(true);
  });

  it('a different accessibility feature list is a venue-requirements change; the same list, reordered, is not', () => {
    expect(
      changeRequestIsSignificant(
        { ...BASE_SCHEDULE, ...BASE_EXTRAS },
        { ...BASE_SCHEDULE, ...BASE_EXTRAS, accessibilityFeatureIds: ['feature-2'] },
      ),
    ).toBe(true);
    expect(
      changeRequestIsSignificant(
        { ...BASE_SCHEDULE, ...BASE_EXTRAS, accessibilityFeatureIds: ['feature-1', 'feature-2'] },
        { ...BASE_SCHEDULE, ...BASE_EXTRAS, accessibilityFeatureIds: ['feature-2', 'feature-1'] },
      ),
    ).toBe(false);
  });

  it('an equipment requirements change (required flag, item list or technical support notes) is significant', () => {
    expect(
      changeRequestIsSignificant(
        { ...BASE_SCHEDULE, ...BASE_EXTRAS },
        { ...BASE_SCHEDULE, ...BASE_EXTRAS, equipmentRequired: true },
      ),
    ).toBe(true);
    expect(
      changeRequestIsSignificant(
        { ...BASE_SCHEDULE, ...BASE_EXTRAS },
        { ...BASE_SCHEDULE, ...BASE_EXTRAS, equipmentItems: [{ item: 'Projector', quantity: 4 }] },
      ),
    ).toBe(true);
    expect(
      changeRequestIsSignificant(
        { ...BASE_SCHEDULE, ...BASE_EXTRAS },
        { ...BASE_SCHEDULE, ...BASE_EXTRAS, technicalSupportNotes: 'Needs a second mic' },
      ),
    ).toBe(true);
  });

  it('the same equipment list in a different order is not a change', () => {
    expect(
      changeRequestIsSignificant(
        { ...BASE_SCHEDULE, ...BASE_EXTRAS, equipmentItems: [{ item: 'Mic', quantity: 1 }, { item: 'Projector', quantity: 2 }] },
        { ...BASE_SCHEDULE, ...BASE_EXTRAS, equipmentItems: [{ item: 'Projector', quantity: 2 }, { item: 'Mic', quantity: 1 }] },
      ),
    ).toBe(false);
  });
});

describe('changeRequestArrangementCauses (AC4 TC-190-04) — reuses SCRUM-111\'s changeCauses as-is', () => {
  it('a date change causes both a booking and a reservation cause', () => {
    const causes = changeRequestArrangementCauses(BASE_SCHEDULE, { ...BASE_SCHEDULE, proposedDate: '2027-03-22' });
    expect(causes.booking).toMatch(/Date changed/);
    expect(causes.reservation).toMatch(/Date changed/);
  });

  it('an attendance-only change causes a booking cause but no reservation cause', () => {
    const causes = changeRequestArrangementCauses(BASE_SCHEDULE, { ...BASE_SCHEDULE, expectedAttendance: 200 });
    expect(causes.booking).toMatch(/Expected attendance changed/);
    expect(causes.reservation).toBeNull();
  });

  it('no schedule change causes neither', () => {
    const causes = changeRequestArrangementCauses(BASE_SCHEDULE, BASE_SCHEDULE);
    expect(causes).toEqual({ booking: null, reservation: null });
  });
});

describe('outstandingReviewArrangements (AC2/AC3 TC-190-02/03)', () => {
  const needs = { venue: 'essential' as const, equipment: 'not_required' as const, technicalSupport: 'not_required' as const, registration: 'not_required' as const };

  it('AC2 names a flagged booking when venue is essential', () => {
    const outstanding = outstandingReviewArrangements(needs, { bookings: ['Marina Bay Ballroom, 22/03/2027, 10:00 to 12:00'], reservations: [] });
    expect(outstanding).toEqual(['Venue: Marina Bay Ballroom, 22/03/2027, 10:00 to 12:00 is marked for review.']);
  });

  it('AC3 a flagged reservation never blocks while equipment is not marked essential', () => {
    const outstanding = outstandingReviewArrangements(needs, { bookings: [], reservations: ['Projector P-100 × 2'] });
    expect(outstanding).toEqual([]);
  });

  it('nothing outstanding when nothing is flagged', () => {
    expect(outstandingReviewArrangements(needs, { bookings: [], reservations: [] })).toEqual([]);
  });
});
