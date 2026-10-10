import { describe, it, expect } from 'vitest';
import {
  accessibilityNeedsFor,
  accessibilityRequirement,
  capacityRequirement,
  needsFor,
  sameNeeds,
  unmetRequirements,
  verdictOf,
  type AccessibilityNeeds,
  type CheckedNeeds,
} from '@/domain/suitability/policy';

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
 *   AC4 "Given a booking request carries its own attendance, layout or
 *        accessibility needs, when the venue is checked for that request, then
 *        those are used instead of the event's."
 *
 * Two requirements are checked: capacity (SCRUM-136) and accessibility, whose
 * rule is SCRUM-137's and is stood in for by D-17 (accessibilityRequirement).
 *
 * Test case IDs are from Joshua's Sprint 3 sheet (TC-135-nn). S135 Hall:
 * maximum 200, Theatre 120, Banquet 100, accessibility Step-free access.
 */

const STEP_FREE = { id: '11111111-1111-4111-8111-111111111111', name: 'Step-free access' };
const HEARING_LOOP = { id: '22222222-2222-4222-8222-222222222222', name: 'Hearing loop' };

const S135_HALL = {
  maxCapacity: 200,
  layouts: [
    { layout: 'theatre' as const, capacity: 120 },
    { layout: 'banquet' as const, capacity: 100 },
  ],
  accessibilityFeatures: [STEP_FREE],
};

const NONE_REQUIRED: AccessibilityNeeds = { accessibilityRequired: false, accessibilityFeatures: [] };
const UNANSWERED: AccessibilityNeeds = { accessibilityRequired: null, accessibilityFeatures: [] };
const needs = (accessibilityFeatures: AccessibilityNeeds['accessibilityFeatures']): AccessibilityNeeds => ({
  accessibilityRequired: true,
  accessibilityFeatures,
});

/** Both requirements for an event against a venue, as the service builds them. */
function check(
  expectedAttendance: number | null,
  accessibility: AccessibilityNeeds,
  venueFeatures: AccessibilityNeeds['accessibilityFeatures'] = S135_HALL.accessibilityFeatures,
) {
  const requirements = [
    capacityRequirement({ expectedAttendance, roomLayout: 'theatre' }, S135_HALL),
    accessibilityRequirement(accessibility, venueFeatures),
  ];
  return { requirements, verdict: verdictOf(requirements) };
}

describe('SCRUM-135 AC1: exactly one verdict over every requirement', () => {
  it('TC-135-01 is Suitable when everything is recorded on both sides and met (80, accessibility None)', () => {
    expect(check(80, NONE_REQUIRED).verdict).toBe('suitable');
  });

  it('TC-135-02 is Not suitable when a recorded requirement is breached (150 in Theatre 120)', () => {
    expect(check(150, NONE_REQUIRED).verdict).toBe('not_suitable');
  });

  it('TC-135-03 is Suitable with concerns when an event requirement is unrecorded (no attendance)', () => {
    expect(check(null, NONE_REQUIRED).verdict).toBe('suitable_with_concerns');
  });

  it('TC-135-04 is Suitable with concerns when a venue attribute is unrecorded (no accessibility features)', () => {
    expect(check(80, needs([STEP_FREE]), []).verdict).toBe('suitable_with_concerns');
  });

  it('TC-135-05 is only Not suitable when a breach and an unrecorded requirement come together', () => {
    expect(check(150, UNANSWERED).verdict).toBe('not_suitable');
  });
});

describe('accessibilityRequirement: the D-17 stand-in for SCRUM-137', () => {
  it('is unverified when the event has not answered the accessibility question', () => {
    expect(accessibilityRequirement(UNANSWERED, [STEP_FREE])).toMatchObject({
      outcome: 'unverified',
      eventValue: 'Not recorded',
      detail: 'Accessibility needs are not recorded.',
    });
  });

  it('is met when the event needs none', () => {
    expect(accessibilityRequirement(NONE_REQUIRED, [])).toMatchObject({ outcome: 'met', eventValue: 'None required' });
  });

  it('is not met, naming each missing feature, when the venue lacks one', () => {
    expect(accessibilityRequirement(needs([HEARING_LOOP]), [STEP_FREE])).toMatchObject({
      outcome: 'not_met',
      eventValue: 'Hearing loop',
      venueValue: 'Step-free access',
      detail: 'Missing: Hearing loop.',
    });
  });

  it('is met when the venue records every feature needed', () => {
    expect(accessibilityRequirement(needs([STEP_FREE]), [STEP_FREE, HEARING_LOOP]).outcome).toBe('met');
  });

  it('is unverified when the venue records no accessibility features at all', () => {
    expect(accessibilityRequirement(needs([STEP_FREE]), [])).toMatchObject({
      outcome: 'unverified',
      venueValue: 'None recorded',
      detail: 'The venue has no accessibility features recorded.',
    });
  });

  it('is unverified when accessibility is required but no feature is named', () => {
    expect(accessibilityRequirement(needs([]), [STEP_FREE]).outcome).toBe('unverified');
  });
});

describe('unmetRequirements: SCRUM-135 AC2, each requirement not met side by side', () => {
  it('TC-135-06 lists the breached capacity with the venue value and the event requirement', () => {
    expect(unmetRequirements(check(150, NONE_REQUIRED).requirements)).toEqual([
      expect.objectContaining({ label: 'Capacity', eventValue: '150 expected', venueValue: '120 (Theatre capacity)' }),
    ]);
  });

  it('TC-135-07 lists the unrecorded attendance as the reason for concerns, with both sides', () => {
    expect(unmetRequirements(check(null, NONE_REQUIRED).requirements)).toEqual([
      expect.objectContaining({ label: 'Capacity', eventValue: 'Not recorded', venueValue: '120 (Theatre capacity)' }),
    ]);
  });

  it('TC-135-08 lists nothing for a Suitable verdict', () => {
    expect(unmetRequirements(check(80, NONE_REQUIRED).requirements)).toEqual([]);
  });

  it('lists every requirement not met, not just the first', () => {
    const unmet = unmetRequirements(check(150, needs([HEARING_LOOP])).requirements);
    expect(unmet.map((requirement) => requirement.label)).toEqual(['Capacity', 'Accessibility']);
  });
});

describe('sameNeeds: SCRUM-135 AC3, have the requirements changed since the check?', () => {
  const base: CheckedNeeds = { expectedAttendance: 150, roomLayout: 'theatre', accessibility: needs([STEP_FREE, HEARING_LOOP]) };

  it('TC-135-09 is unchanged when everything the check read is as it was, in any order', () => {
    expect(sameNeeds(base, { ...base, accessibility: needs([HEARING_LOOP, STEP_FREE]) })).toBe(true);
  });

  it('TC-135-10 has changed when the attendance has', () => {
    expect(sameNeeds(base, { ...base, expectedAttendance: 80 })).toBe(false);
  });

  it('has changed when the layout has, including to no specific layout', () => {
    expect(sameNeeds(base, { ...base, roomLayout: null })).toBe(false);
  });

  it('has changed when the accessibility answer or features have', () => {
    expect(sameNeeds(base, { ...base, accessibility: NONE_REQUIRED })).toBe(false);
    expect(sameNeeds(base, { ...base, accessibility: needs([STEP_FREE]) })).toBe(false);
  });
});

describe("SCRUM-135 AC4: a booking request's own needs are used instead of the event's", () => {
  it("TC-135-11 uses the request's attendance and layout (110 in Banquet 100), not the event's (80 in Theatre)", () => {
    const requestNeeds = needsFor({ expectedAttendance: 80, roomLayout: 'theatre' }, { expectedAttendance: 110, roomLayout: 'banquet' });
    expect(capacityRequirement(requestNeeds, S135_HALL)).toMatchObject({
      outcome: 'not_met',
      eventValue: '110 expected',
      venueValue: '100 (Banquet capacity)',
    });
  });

  it("TC-135-12 uses the request's hearing loop, not the event's None, so step-free access alone does not meet it", () => {
    const requestNeeds = accessibilityNeedsFor(NONE_REQUIRED, needs([HEARING_LOOP]));
    expect(accessibilityRequirement(requestNeeds, [STEP_FREE])).toMatchObject({
      outcome: 'not_met',
      eventValue: 'Hearing loop',
      venueValue: 'Step-free access',
    });
  });

  it("falls back to the event's accessibility when the request leaves it unanswered", () => {
    expect(accessibilityNeedsFor(NONE_REQUIRED, { accessibilityRequired: null })).toEqual(NONE_REQUIRED);
    expect(accessibilityNeedsFor(NONE_REQUIRED, null)).toEqual(NONE_REQUIRED);
  });
});
