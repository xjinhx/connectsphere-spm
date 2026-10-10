import { describe, it, expect } from 'vitest';
import { capacityRequirement, sameNeeds, unmetRequirements, verdictOf } from '@/domain/suitability/policy';

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
 *
 * Capacity (SCRUM-136) is the one requirement checked until SCRUM-137 adds
 * layout, accessibility and facilities. Test case IDs are from Joshua's Sprint
 * 3 sheet (TC-135-nn); the venue is S135 Hall: maximum 200, Theatre 120.
 */

const S135_HALL = { maxCapacity: 200, layouts: [{ layout: 'theatre' as const, capacity: 120 }] };

describe('SCRUM-135 AC1: exactly one verdict', () => {
  it('TC-135-01 is suitable when the recorded attendance fits (80 in Theatre 120)', () => {
    expect(verdictOf([capacityRequirement({ expectedAttendance: 80, roomLayout: 'theatre' }, S135_HALL)])).toBe('suitable');
  });

  it('TC-135-02 is not suitable when a recorded requirement is breached (150 in Theatre 120)', () => {
    expect(verdictOf([capacityRequirement({ expectedAttendance: 150, roomLayout: 'theatre' }, S135_HALL)])).toBe('not_suitable');
  });

  it('TC-135-03 is suitable with concerns when an event requirement is unrecorded', () => {
    expect(verdictOf([capacityRequirement({ expectedAttendance: null, roomLayout: 'theatre' }, S135_HALL)])).toBe(
      'suitable_with_concerns',
    );
  });

  it('TC-135-04 is suitable with concerns when a venue attribute is unrecorded (no capacity for the layout)', () => {
    expect(verdictOf([capacityRequirement({ expectedAttendance: 80, roomLayout: 'cabaret' }, S135_HALL)])).toBe(
      'suitable_with_concerns',
    );
  });
});

describe('unmetRequirements: SCRUM-135 AC2', () => {
  it('TC-135-06 lists the breached capacity with the venue value and the event requirement', () => {
    const unmet = unmetRequirements([capacityRequirement({ expectedAttendance: 150, roomLayout: 'theatre' }, S135_HALL)]);
    expect(unmet).toEqual([expect.objectContaining({ label: 'Capacity', eventValue: '150 expected', venueValue: '120 (Theatre capacity)' })]);
  });

  it('TC-135-07 lists the unrecorded attendance as the reason for concerns, with both sides', () => {
    const unmet = unmetRequirements([capacityRequirement({ expectedAttendance: null, roomLayout: 'theatre' }, S135_HALL)]);
    expect(unmet).toEqual([expect.objectContaining({ eventValue: 'Not recorded', venueValue: '120 (Theatre capacity)' })]);
  });

  it('TC-135-08 lists nothing for a suitable verdict', () => {
    expect(unmetRequirements([capacityRequirement({ expectedAttendance: 80, roomLayout: 'theatre' }, S135_HALL)])).toEqual([]);
  });
});

describe('sameNeeds: SCRUM-135 AC3, have the requirements changed since the check?', () => {
  it('TC-135-09 is unchanged when attendance and layout are as they were', () => {
    expect(sameNeeds({ expectedAttendance: 150, roomLayout: 'theatre' }, { expectedAttendance: 150, roomLayout: 'theatre' })).toBe(true);
  });

  it('TC-135-10 has changed when the attendance has', () => {
    expect(sameNeeds({ expectedAttendance: 80, roomLayout: 'theatre' }, { expectedAttendance: 150, roomLayout: 'theatre' })).toBe(false);
  });

  it('has changed when the layout has, including to no specific layout', () => {
    expect(sameNeeds({ expectedAttendance: 80, roomLayout: 'theatre' }, { expectedAttendance: 80, roomLayout: null })).toBe(false);
  });
});
