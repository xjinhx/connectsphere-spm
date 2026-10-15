import { describe, it, expect } from 'vitest';
import { capacityRequirement, needsOfRequest, toRoomLayout, verdictOf } from '@/domain/suitability/policy';
import { venueRequirementsOf } from '@/domain/venue-booking/policy';
import { CheckSuitabilityInputSchema, type RequirementResult } from '@/domain/suitability/schema';

/**
 * SCRUM-136 Flag a venue whose capacity is exceeded: the rule on its own. The
 * check against stored events and venues is
 * tests/integration/suitability-capacity.test.ts.
 *
 * AC text is from the Jira card (authoritative):
 *   AC1 "Given an event expects 150 attendees and the venue's capacity for the
 *        required layout is 120, when suitability is checked, then the venue is
 *        marked not suitable and the shortfall of 30 is stated."
 *   AC2 "Given an event expects 100 attendees and the venue's capacity for the
 *        required layout is exactly 100, when suitability is checked, then no
 *        capacity failure is raised."
 *   AC3 "Given an event has no expected attendance recorded, when suitability
 *        is checked, then the venue is marked suitable with concerns and
 *        expected attendance is named as the unverified item."
 *   AC4 "Given the event requires no specific layout, when suitability is
 *        checked, then the venue's maximum capacity is used instead of a layout
 *        capacity."
 *   AC5 "Given a booking request carries its own expected attendance, when
 *        suitability is checked for that request, then that attendance is used
 *        instead of the event's."
 *
 * Test case IDs are from Joshua's Sprint 3 sheet (TC-136-nn). The venue is the
 * sheet's S136 Hall: maximum capacity 200, Theatre 120, Banquet 100.
 */

const S136_HALL = {
  maxCapacity: 200,
  layouts: [
    { layout: 'theatre' as const, capacity: 120 },
    { layout: 'banquet' as const, capacity: 100 },
  ],
};

const check = (expectedAttendance: number | null, roomLayout: 'theatre' | 'banquet' | 'cabaret' | null) => {
  const result = capacityRequirement({ expectedAttendance, roomLayout }, S136_HALL);
  return { result, verdict: verdictOf([result]) };
};

describe('capacityRequirement: SCRUM-136 AC1, attendance above the layout capacity', () => {
  it('TC-136-01 is not suitable and states the shortfall of 30 (150 against Theatre 120)', () => {
    const { result, verdict } = check(150, 'theatre');
    expect(verdict).toBe('not_suitable');
    expect(result).toMatchObject({ outcome: 'not_met', shortfall: 30, eventValue: '150 expected', venueValue: '120 (Theatre capacity)' });
    expect(result.detail).toBe('Short by 30: 150 expected against a Theatre capacity of 120.');
  });

  it('TC-136-02 states a shortfall of 1 (101 against Banquet 100)', () => {
    const { result, verdict } = check(101, 'banquet');
    expect(verdict).toBe('not_suitable');
    expect(result.shortfall).toBe(1);
  });
});

describe('capacityRequirement: SCRUM-136 AC2, attendance at or under the layout capacity', () => {
  it('TC-136-03 raises no capacity failure when attendance equals the capacity (100 against Banquet 100)', () => {
    const { result, verdict } = check(100, 'banquet');
    expect(result.outcome).toBe('met');
    expect(result.shortfall).toBeNull();
    expect(verdict).toBe('suitable');
  });

  it('TC-136-04 raises no capacity failure one under the capacity (99 against Banquet 100)', () => {
    expect(check(99, 'banquet').result.outcome).toBe('met');
  });
});

describe('capacityRequirement: SCRUM-136 AC3, no expected attendance recorded', () => {
  it('TC-136-05 is suitable with concerns and names expected attendance as unverified', () => {
    const { result, verdict } = check(null, 'theatre');
    expect(verdict).toBe('suitable_with_concerns');
    expect(result).toMatchObject({ outcome: 'unverified', eventValue: 'Not recorded', detail: 'Expected attendance is not recorded.' });
  });
});

describe('capacityRequirement: SCRUM-136 AC4, no specific layout uses the maximum capacity', () => {
  it('TC-136-06 checks 150 against the maximum of 200, not Theatre 120, and raises nothing', () => {
    const { result } = check(150, null);
    expect(result).toMatchObject({ outcome: 'met', venueValue: '200 (maximum capacity)' });
  });

  it('TC-136-07 is not suitable one over the maximum, with a shortfall of 1', () => {
    const { result, verdict } = check(201, null);
    expect(verdict).toBe('not_suitable');
    expect(result.shortfall).toBe(1);
    expect(result.detail).toBe('Short by 1: 201 expected against a maximum capacity of 200.');
  });

  it('reads an event layout that is not a catalogue layout as no specific layout', () => {
    expect(toRoomLayout(null)).toBeNull();
    expect(toRoomLayout('theatre')).toBe('theatre');
  });
});

describe('capacityRequirement: a required layout the venue has no capacity for', () => {
  it('cannot be verified, so it is suitable with concerns rather than a breach (SCRUM-137 owns "unsupported layout")', () => {
    const { result, verdict } = check(80, 'cabaret');
    expect(verdict).toBe('suitable_with_concerns');
    expect(result).toMatchObject({ outcome: 'unverified', venueValue: 'No Cabaret capacity recorded' });
  });
});

describe("needsOfRequest: SCRUM-136 AC5, a booking request's own attendance (SCRUM-230's venueRequirementsOf)", () => {
  const eventRequirements = (expectedAttendance: number | null, roomLayout: string | null) => ({
    expectedAttendance,
    roomLayout,
    accessibilityRequired: false,
    accessibilityNotes: null,
    accessibilityFeatures: [],
  });
  const own = (expectedAttendance: number | null, roomLayout: string | null = null) => ({
    expectedAttendance,
    roomLayout,
    accessibilityRequired: null,
    accessibilityNotes: null,
  });

  it("TC-136-08 uses the request's higher attendance, so 150 is short by 30 against Theatre 120", () => {
    const needs = needsOfRequest(venueRequirementsOf(own(150), eventRequirements(80, 'theatre')));
    expect(capacityRequirement(needs, S136_HALL).shortfall).toBe(30);
  });

  it("TC-136-09 uses the request's lower attendance, so 80 raises nothing where the event's 150 would", () => {
    const needs = needsOfRequest(venueRequirementsOf(own(80), eventRequirements(150, 'theatre')));
    expect(capacityRequirement(needs, S136_HALL).outcome).toBe('met');
  });

  it("falls back to the event's attendance and layout where the request leaves them empty", () => {
    expect(needsOfRequest(venueRequirementsOf(own(null), eventRequirements(80, 'theatre')))).toEqual({
      expectedAttendance: 80,
      roomLayout: 'theatre',
    });
  });
});

describe('verdictOf: exactly one verdict', () => {
  const result = (outcome: RequirementResult['outcome']): RequirementResult => ({
    requirement: 'capacity',
    label: 'Capacity',
    outcome,
    eventValue: '',
    venueValue: '',
    detail: null,
    shortfall: null,
  });

  it('is not suitable when anything is breached, even if something else is unverified', () => {
    expect(verdictOf([result('unverified'), result('not_met')])).toBe('not_suitable');
  });

  it('is suitable with concerns when nothing is breached but something is unverified', () => {
    expect(verdictOf([result('met'), result('unverified')])).toBe('suitable_with_concerns');
  });

  it('is suitable when everything is met', () => {
    expect(verdictOf([result('met')])).toBe('suitable');
  });
});

describe('CheckSuitabilityInputSchema: a venue against the event, or a booking request (AC5)', () => {
  const VENUE = '11111111-1111-4111-8111-111111111111';
  const BOOKING_REQUEST = '22222222-2222-4222-8222-222222222222';

  it('accepts a venue, or a booking request, on its own', () => {
    expect(CheckSuitabilityInputSchema.safeParse({ venueId: VENUE }).success).toBe(true);
    expect(CheckSuitabilityInputSchema.safeParse({ bookingRequestId: BOOKING_REQUEST }).success).toBe(true);
  });

  it('refuses both together, or neither', () => {
    for (const input of [{}, { venueId: VENUE, bookingRequestId: BOOKING_REQUEST }]) {
      const parsed = CheckSuitabilityInputSchema.safeParse(input);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toBe('Choose a venue, or one of the booking requests.');
    }
  });

  it('refuses an id that is not a venue or booking request id', () => {
    expect(CheckSuitabilityInputSchema.safeParse({ bookingRequestId: 'not-an-id' }).error?.issues[0]?.message).toBe(
      'Choose a booking request from the list.',
    );
  });
});
