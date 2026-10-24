import { describe, expect, it } from 'vitest';
import { landingPathForRoles } from '@/domain/identity/roles';
import { isNavItemCurrent } from '@/domain/navigation/policy';
import { ROLE_NAV } from '@/domain/navigation/roleNav';

/**
 * SCRUM-254 Technical Support Staff Navigation. Test case IDs match the
 * SCRUM-254 tab of the Sprint 4 test case sheet. The header itself, the
 * removed tabs and AC3's back links are tested by hand.
 */

describe('SCRUM-254 AC1: Technical Support Staff land on /equipment-queue', () => {
  it('TC-254-01: a Technical Support Staff account lands on the equipment queue', () => {
    expect(landingPathForRoles(['technical_support'])).toBe('/equipment-queue');
  });

  it('TC-254-02: another role does not', () => {
    expect(landingPathForRoles(['venue_staff'])).toBe('/booking-queue');
  });

  it('TC-254-04: Technical Support Staff stored second still lands on the equipment queue', () => {
    expect(landingPathForRoles(['coordinator', 'technical_support'])).toBe('/equipment-queue');
  });

  it('TC-254-05: a Lead who is also Technical Support Staff lands on the Lead page', () => {
    expect(landingPathForRoles(['technical_support', 'operations_manager'])).toBe('/assignment-queue');
  });
});

describe('SCRUM-254 AC2: the nav shows the three items in order', () => {
  it('TC-254-06: Equipment requests, Equipment catalogue, Venues, and nothing else', () => {
    expect(ROLE_NAV.technical_support).toEqual([
      { href: '/equipment-queue', label: 'Equipment requests' },
      { href: '/equipment', label: 'Equipment catalogue' },
      { href: '/venues', label: 'Venues' },
    ]);
  });

  it('TC-254-07 / TC-254-08: each page highlights only its own item', () => {
    const current = (pathname: string) =>
      ROLE_NAV.technical_support.filter((item) => isNavItemCurrent(pathname, item.href)).map((item) => item.label);

    expect(current('/equipment-queue')).toEqual(['Equipment requests']);
    expect(current('/equipment')).toEqual(['Equipment catalogue']);
    expect(current('/venues')).toEqual(['Venues']);
    // AC3's pages sit under Venues, so Venues stays highlighted on them.
    expect(current('/venues/abc')).toEqual(['Venues']);
    expect(current('/venues/abc/calendar')).toEqual(['Venues']);
  });
});
