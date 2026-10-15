import { describe, it, expect } from 'vitest';
import {
  capacityRequirement,
  needsOfRequest,
  sameNeeds,
  unmetRequirements,
  verdictOf,
  type SuitabilityNeeds,
} from '@/domain/suitability/policy';
import { venueRequirementsOf } from '@/domain/venue-booking/policy';
import type { RequirementResult } from '@/domain/suitability/schema';

/**
 * SCRUM-135 Check a selected venue against the event's requirements: the
 * rules on their own. The stored check is tests/integration/suitability-check.test.ts.
 *
 * AC text is from the Jira card (authoritative):
 *   AC1 "... exactly one verdict is returned: suitable when every requirement
 *        is recorded on both sides and met; suitable with concerns when nothing
 *        is breached but at least one requirement or venue attribute is
 *        unrecorded; not suitable when at least one recorded requirement is
 *        breached."
 *   AC2 "Given the verdict is anything other than suitable, when I view it,
 *        then each requirement not met is listed with the venue value and the
 *        event requirement side by side."
 *   AC3 "Given a suitability check has been run and the event's requirements
 *        have not changed since, when I reopen that venue against the event,
 *        then the stored verdict, the unmet requirements and the time the
 *        check was run are shown without re-running the check."
 *   AC4 "Given a booking request carries its own attendance, layout ...,
 *        when the venue is checked for that request, then those are used
 *        instead of the event's."
 *
 * Capacity is the only requirement checked (SCRUM-136's rule): SCRUM-135 is
 * capacity only (PO decision, Slack 10 Oct 2026). Accessibility, layouts,
 * facilities and operating hours are SCRUM-137's, in no sprint yet.
 *
 * Test case IDs are from Joshua's Sprint 3 sheet (TC-135-nn). S135 Hall:
 * maximum 200, Theatre 120, Banquet 100. S135 Small Hall: maximum 200, Theatre
 * 120 only.
 */

const S135_HALL = {
  maxCapacity: 200,
  layouts: [
    { layout: 'theatre' as const, capacity: 120 },
    { layout: 'banquet' as const, capacity: 100 },
  ],
};

const S135_SMALL_HALL = { maxCapacity: 200, layouts: [{ layout: 'theatre' as const, capacity: 120 }] };

/** The requirements for an event against a venue, as the service builds them. */
function check(needs: SuitabilityNeeds, venue: typeof S135_HALL | typeof S135_SMALL_HALL = S135_HALL) {
  const requirements = [capacityRequirement(needs, venue)];
  return { requirements, verdict: verdictOf(requirements) };
}

describe('SCRUM-135 AC1: exactly one verdict over every requirement', () => {
  it('TC-135-01 is Suitable when everything is recorded on both sides and met (80 in Theatre 120)', () => {
    expect(check({ expectedAttendance: 80, roomLayout: 'theatre' }).verdict).toBe('suitable');
  });

  it('TC-135-02 is Not suitable when a recorded requirement is breached (150 in Theatre 120)', () => {
    expect(check({ expectedAttendance: 150, roomLayout: 'theatre' }).verdict).toBe('not_suitable');
  });

  it('TC-135-03 is Suitable with concerns when an event requirement is unrecorded (no attendance)', () => {
    expect(check({ expectedAttendance: null, roomLayout: 'theatre' }).verdict).toBe('suitable_with_concerns');
  });

  it('TC-135-04 is Suitable with concerns when a venue attribute is unrecorded (no Banquet capacity)', () => {
    const result = check({ expectedAttendance: 80, roomLayout: 'banquet' }, S135_SMALL_HALL);
    expect(result.verdict).toBe('suitable_with_concerns');
    expect(result.requirements[0]).toMatchObject({ outcome: 'unverified', venueValue: 'No Banquet capacity recorded' });
  });

  it('gives Not suitable, not Suitable with concerns, when a breach comes with something unrecorded', () => {
    // The rule SCRUM-137's further requirements will rely on: a breach outweighs anything unverified.
    const breached = { outcome: 'not_met' } as RequirementResult;
    const unverified = { outcome: 'unverified' } as RequirementResult;
    expect(verdictOf([unverified, breached])).toBe('not_suitable');
  });
});

describe('unmetRequirements: SCRUM-135 AC2, each requirement not met side by side', () => {
  it('TC-135-06 lists the breached capacity with the venue value and the event requirement', () => {
    expect(unmetRequirements(check({ expectedAttendance: 150, roomLayout: 'theatre' }).requirements)).toEqual([
      expect.objectContaining({ label: 'Capacity', eventValue: '150 expected', venueValue: '120 (Theatre capacity)' }),
    ]);
  });

  it('TC-135-07 lists the unrecorded attendance as the reason for concerns, with both sides', () => {
    expect(unmetRequirements(check({ expectedAttendance: null, roomLayout: 'theatre' }).requirements)).toEqual([
      expect.objectContaining({ label: 'Capacity', eventValue: 'Not recorded', venueValue: '120 (Theatre capacity)' }),
    ]);
  });

  it('TC-135-08 lists nothing for a Suitable verdict', () => {
    expect(unmetRequirements(check({ expectedAttendance: 80, roomLayout: 'theatre' }).requirements)).toEqual([]);
  });
});

describe('sameNeeds: SCRUM-135 AC3, have the requirements changed since the check?', () => {
  const base: SuitabilityNeeds = { expectedAttendance: 150, roomLayout: 'theatre' };

  it('TC-135-09 is unchanged when the attendance and layout are as they were', () => {
    expect(sameNeeds(base, { ...base })).toBe(true);
  });

  it('TC-135-10 has changed when the attendance has', () => {
    expect(sameNeeds(base, { ...base, expectedAttendance: 80 })).toBe(false);
  });

  it('has changed when the layout has, including to no specific layout', () => {
    expect(sameNeeds(base, { ...base, roomLayout: null })).toBe(false);
  });
});

describe("SCRUM-135 AC4: a booking request's own needs are used instead of the event's", () => {
  it("TC-135-11 uses the request's attendance and layout (110 in Banquet 100), not the event's (80 in Theatre)", () => {
    const requestNeeds = needsOfRequest(
      venueRequirementsOf(
        { expectedAttendance: 110, roomLayout: 'banquet', accessibilityRequired: null, accessibilityNotes: null },
        { expectedAttendance: 80, roomLayout: 'theatre', accessibilityRequired: false, accessibilityNotes: null, accessibilityFeatures: [] },
      ),
    );
    expect(capacityRequirement(requestNeeds, S135_HALL)).toMatchObject({
      outcome: 'not_met',
      eventValue: '110 expected',
      venueValue: '100 (Banquet capacity)',
    });
  });
});
