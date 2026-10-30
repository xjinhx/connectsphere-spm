import { describe, expect, it } from 'vitest';
import { landingPathForRoles } from '@/domain/identity/roles';
import { isNavItemCurrent } from '@/domain/navigation/policy';
import { ROLE_NAV } from '@/domain/navigation/roleNav';

/**
 * SCRUM-253 Venue Staff Navigation. Test case IDs match the SCRUM-253 tab of
 * the Sprint 4 test case sheet. The header itself and AC3/AC4's back links
 * are tested by hand and in tests/e2e/scrum-253-venue-staff-nav.spec.ts.
 */

describe('SCRUM-253 AC1: Venue Staff land on /booking-queue', () => {
  it('TC-253-01: a Venue Staff account lands on the booking queue', () => {
    expect(landingPathForRoles(['venue_staff'])).toBe('/booking-queue');
  });

  it('TC-253-01 (negative): another role does not', () => {
    expect(landingPathForRoles(['technical_support'])).toBe('/equipment-queue');
  });
});

describe('SCRUM-253 AC2: the nav shows Booking requests then Venues, in order', () => {
  it('TC-253-02: Booking requests, Venues, and nothing else', () => {
    expect(ROLE_NAV.venue_staff).toEqual([
      { href: '/booking-queue', label: 'Booking requests' },
      { href: '/venues', label: 'Venues' },
    ]);
  });

  it('TC-253-02: each page highlights only its own item', () => {
    const current = (pathname: string) =>
      ROLE_NAV.venue_staff.filter((item) => isNavItemCurrent(pathname, item.href)).map((item) => item.label);

    expect(current('/booking-queue')).toEqual(['Booking requests']);
    expect(current('/venues')).toEqual(['Venues']);
    // AC3/AC4's pages sit under their parent, which stays highlighted.
    expect(current('/venue-booking-requests/abc')).toEqual([]);
    expect(current('/venues/abc')).toEqual(['Venues']);
    expect(current('/venues/abc/edit')).toEqual(['Venues']);
    expect(current('/venues/abc/calendar')).toEqual(['Venues']);
  });
});

describe('TC-253-05: a non-Venue-Staff role does not see the Venue Staff nav', () => {
  it('a coordinator sees its own nav, not Booking requests or Venues', () => {
    const labels = ROLE_NAV.coordinator.map((item) => item.label);
    expect(labels).not.toContain('Booking requests');
    expect(ROLE_NAV.coordinator).not.toEqual(ROLE_NAV.venue_staff);
  });

  it('an Event Organiser sees its own nav, not Booking requests or Venues', () => {
    const labels = ROLE_NAV.event_organiser.map((item) => item.label);
    expect(labels).not.toContain('Booking requests');
    expect(labels).not.toContain('Venues');
  });
});
