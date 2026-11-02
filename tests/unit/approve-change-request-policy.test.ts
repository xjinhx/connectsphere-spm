import { describe, expect, it } from 'vitest';
import {
  arrangementReviewMessage,
  attendeeChangeMessage,
  canDecideChangeRequestFor,
  changeAffectsAttendees,
  changeRequestArrangementCauses,
  changeRequestIsSignificant,
  type AttendeeFacingDetails,
  type ChangeRequestExtras,
} from '@/domain/change-request/policy';
import { outstandingReviewArrangements } from '@/domain/essential-arrangements/policy';
import { notificationHref } from '@/domain/notification/policy';
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

describe('arrangementReviewMessage and its link (AC4 TC-190-04)', () => {
  const booking = 'Date changed from 29/11/2026 to 06/12/2026';
  const reservation = 'Times changed from 10:00–12:00 to 11:00–13:00';

  it('TC-190-04 Venue Staff are told what changed on the booking they approved, and nothing about equipment', () => {
    expect(arrangementReviewMessage('Tech Summit', { booking, reservation: null })).toBe(
      'An approved change to "Tech Summit" means an arrangement you actioned now needs review. ' +
        'Venue booking: Date changed from 29/11/2026 to 06/12/2026.',
    );
  });

  it('TC-190-04 Technical Support Staff are told what changed on the equipment they reserved', () => {
    const message = arrangementReviewMessage('Tech Summit', { booking: null, reservation });
    expect(message).toContain('Equipment reservation: Times changed from 10:00–12:00 to 11:00–13:00.');
    expect(message).not.toContain('Venue booking');
  });

  it('TC-190-04 someone who actioned both gets both, in one message', () => {
    const message = arrangementReviewMessage('Tech Summit', { booking, reservation });
    expect(message).toContain('Venue booking: ');
    expect(message).toContain('Equipment reservation: ');
  });

  it("TC-190-04 the staff notification opens the notifications page, not the organiser's event page they can't open", () => {
    const eventRequestId = '11111111-1111-4111-8111-111111111111';
    expect(notificationHref({ type: 'arrangement_needs_review', eventRequestId })).toBe('/notifications');
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

describe('changeAffectsAttendees and attendeeChangeMessage (AC5 TC-190-05)', () => {
  const SHOWN: AttendeeFacingDetails = {
    name: 'Client Appreciation Night',
    description: 'Dinner and awards',
    proposedDate: '2027-03-15',
    startTime: '10:00',
    endTime: '12:00',
  };

  it('TC-190-05 a new date, new times, a new name or a new description affects registered attendees', () => {
    expect(changeAffectsAttendees(SHOWN, { ...SHOWN, proposedDate: '2027-03-22' })).toBe(true);
    expect(changeAffectsAttendees(SHOWN, { ...SHOWN, startTime: '11:00', endTime: '13:00' })).toBe(true);
    expect(changeAffectsAttendees(SHOWN, { ...SHOWN, name: 'Client Appreciation Night 2.0' })).toBe(true);
    expect(changeAffectsAttendees(SHOWN, { ...SHOWN, description: 'Dinner only' })).toBe(true);
  });

  it('TC-190-05 nothing attendees are shown changed (attendance, venue or equipment only), so nobody is told', () => {
    expect(changeAffectsAttendees(SHOWN, { ...SHOWN })).toBe(false);
    expect(changeAffectsAttendees({ ...SHOWN, description: null }, { ...SHOWN, description: '' })).toBe(false);
  });

  it('TC-190-05 the message gives the new date as DD/MM/YYYY and the new times', () => {
    expect(attendeeChangeMessage({ ...SHOWN, proposedDate: '2027-03-22', startTime: '11:00', endTime: '13:00' })).toBe(
      '"Client Appreciation Night", which you registered for, has changed. It is now on 22/03/2027, 11:00–13:00.',
    );
  });

  it("TC-190-05 the attendee's notification opens their own page for the event, not the organiser's", () => {
    expect(notificationHref({ type: 'event_details_changed', eventRequestId: 'e1' })).toBe('/register-events/e1');
  });
});
