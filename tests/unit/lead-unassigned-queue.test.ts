import { describe, expect, it } from 'vitest';
import { isActionPermitted } from '@/domain/identity/permissions';

// SCRUM-232 — Give the unassigned queue to the Event Coordinator Lead.
// Test case IDs are from the SCRUM-232 tab of ConnectSphere_TestCases_Sprint3.xlsx.
//
// AC4 — the server-side half of TC-232-11 to TC-232-14: the assign and reassign
// routes and the Lead's pages all check coordinator_assignment. An account can
// hold several roles (customer clarification #56), so the check is made against
// role combinations, not single roles.

describe('SCRUM-232 AC4 — only the Lead may assign or reassign', () => {
  it('TC-232-11: A Coordinator cannot assign', () => {
    expect(isActionPermitted(['coordinator'], 'coordinator_assignment')).toBe(false);
  });

  it('TC-232-13: An Organiser cannot assign', () => {
    expect(isActionPermitted(['event_organiser'], 'coordinator_assignment')).toBe(false);
  });

  it('TC-232-14: Several roles without the Lead role still cannot assign', () => {
    expect(isActionPermitted(['coordinator', 'venue_staff'], 'coordinator_assignment')).toBe(false);
    expect(
      isActionPermitted(
        ['event_organiser', 'coordinator', 'venue_staff', 'technical_support', 'attendee'],
        'coordinator_assignment',
      ),
    ).toBe(false);
  });

  it('TC-232-14 (control): Lead alongside Coordinator can assign', () => {
    expect(isActionPermitted(['coordinator', 'operations_manager'], 'coordinator_assignment')).toBe(true);
  });
});
