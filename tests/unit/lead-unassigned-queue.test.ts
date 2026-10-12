import { describe, expect, it } from 'vitest';
import { isActionPermitted } from '@/domain/identity/permissions';

// SCRUM-232 — Give the unassigned queue to the Event Coordinator Lead.
// An account can hold several roles (customer clarification #56), so AC4 is
// checked against role combinations, not single roles: holding the Lead role
// is what permits assigning, and no mix of other roles adds up to it.

describe('SCRUM-232 AC4 — only the Lead may assign or reassign', () => {
  it('permits an account holding the Lead role alongside Coordinator', () => {
    expect(isActionPermitted(['coordinator', 'operations_manager'], 'coordinator_assignment')).toBe(true);
  });

  it('refuses an account holding several roles, none of them Lead', () => {
    expect(isActionPermitted(['coordinator', 'venue_staff'], 'coordinator_assignment')).toBe(false);
    expect(
      isActionPermitted(
        ['event_organiser', 'coordinator', 'venue_staff', 'technical_support', 'attendee'],
        'coordinator_assignment',
      ),
    ).toBe(false);
  });
});
