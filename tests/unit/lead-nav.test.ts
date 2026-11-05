import { describe, expect, it } from 'vitest';
import { landingPathForRoles } from '@/domain/identity/roles';
import { isNavItemCurrent } from '@/domain/navigation/policy';
import { ROLE_NAV } from '@/domain/navigation/roleNav';

/**
 * SCRUM-252 Event Coordinator Lead Navigation. Test case IDs match the
 * SCRUM-252 tab of the Sprint 4 test case sheet. The header itself, AC3's
 * back/event links and AC4's role-naming sweep are tested by hand.
 */

describe('SCRUM-252 AC1: an Event Coordinator Lead lands on /assignment-queue', () => {
  it('TC-252-01: a Lead-only account lands on the assignment queue', () => {
    expect(landingPathForRoles(['operations_manager'])).toBe('/assignment-queue');
  });

  it('TC-252-02: a Lead who also holds another role still lands there (role priority)', () => {
    expect(landingPathForRoles(['coordinator', 'operations_manager'])).toBe('/assignment-queue');
  });
});

describe('SCRUM-252 AC2: the nav shows the three items in order', () => {
  it('TC-252-03: Unassigned queue, Coordinators, Venues, and nothing else', () => {
    expect(ROLE_NAV.operations_manager).toEqual([
      { href: '/assignment-queue', label: 'Unassigned queue' },
      { href: '/coordinator-overview', label: 'Coordinators' },
      { href: '/venues', label: 'Venues' },
    ]);
  });

  it('TC-252-04: each page highlights only its own item', () => {
    const current = (pathname: string) =>
      ROLE_NAV.operations_manager.filter((item) => isNavItemCurrent(pathname, item.href)).map((item) => item.label);

    expect(current('/assignment-queue')).toEqual(['Unassigned queue']);
    expect(current('/coordinator-overview')).toEqual(['Coordinators']);
    expect(current('/venues')).toEqual(['Venues']);
    // AC3's event-assignment page sits under the queue, so the queue item
    // itself is not the one highlighted there (its own href is
    // /assignment-queue/[id], not under /assignment-queue as a parent path).
    expect(current('/venues/abc')).toEqual(['Venues']);
    expect(current('/venues/abc/calendar')).toEqual(['Venues']);
  });
});
