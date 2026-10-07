import { describe, it, expect } from 'vitest';
import {
  NOT_SPECIFIED,
  describeAccessibilityForVenueStaff,
  describeAttendanceForVenueStaff,
  describeLayoutForVenueStaff,
} from '@/domain/venue-booking/policy';

/**
 * SCRUM-143 AC2 and AC4 — how the event's requirements read for Venue Staff.
 *
 * AC2 "...the event's expected attendance, required layout and accessibility
 *     needs are shown as recorded on the event."
 * AC4 "Given the event has no recorded layout or accessibility need, when I
 *     open the request, then those fields are shown as not specified rather
 *     than blank."
 *
 * Test case IDs match the SCRUM-143 sheet of the Sprint 2 test case workbook.
 */

const noAccessibility = { accessibilityRequired: null, accessibilityFeatures: [], accessibilityNotes: null };

describe('SCRUM-143 AC2 — shown as recorded', () => {
  it('TC-143-02: shows attendance, layout, features and the note as recorded', () => {
    expect(describeAttendanceForVenueStaff(120)).toBe('120');
    expect(describeLayoutForVenueStaff('banquet')).toBe('Banquet');
    expect(
      describeAccessibilityForVenueStaff({
        accessibilityRequired: true,
        accessibilityFeatures: [{ name: 'Step-free access' }, { name: 'Accessible toilet' }],
        accessibilityNotes: 'Two guests use wheelchairs; keep the aisle by table 1 clear',
      }),
    ).toBe('Step-free access, Accessible toilet\nTwo guests use wheelchairs; keep the aisle by table 1 clear');
  });

  it("TC-143-03: an accessibility answer of 'None' is shown as recorded, not as not specified", () => {
    expect(
      describeAccessibilityForVenueStaff({ accessibilityRequired: false, accessibilityFeatures: [], accessibilityNotes: null }),
    ).toBe('None required');
    expect(describeLayoutForVenueStaff('theatre')).toBe('Theatre');
  });
});

describe('SCRUM-143 AC4 — not specified rather than blank', () => {
  it('TC-143-07: no layout and no accessibility answer both read "Not specified"; attendance still shown', () => {
    expect(describeLayoutForVenueStaff(null)).toBe(NOT_SPECIFIED);
    expect(describeAccessibilityForVenueStaff(noAccessibility)).toBe(NOT_SPECIFIED);
    expect(describeAttendanceForVenueStaff(30)).toBe('30');
  });

  it('TC-143-08: only the layout missing — layout not specified, accessibility as recorded', () => {
    expect(describeLayoutForVenueStaff(null)).toBe(NOT_SPECIFIED);
    expect(
      describeAccessibilityForVenueStaff({
        accessibilityRequired: true,
        accessibilityFeatures: [{ name: 'Step-free access' }],
        accessibilityNotes: null,
      }),
    ).toBe('Step-free access');
  });

  it('TC-143-09: only the accessibility answer missing — accessibility not specified, layout as recorded', () => {
    expect(describeLayoutForVenueStaff('boardroom')).toBe('Boardroom');
    expect(describeAccessibilityForVenueStaff(noAccessibility)).toBe(NOT_SPECIFIED);
  });

  it('never returns a blank for a missing value', () => {
    expect(describeAttendanceForVenueStaff(null)).toBe(NOT_SPECIFIED);
    expect(describeLayoutForVenueStaff('')).toBe(NOT_SPECIFIED);
    expect(NOT_SPECIFIED.trim()).not.toBe('');
  });
});
