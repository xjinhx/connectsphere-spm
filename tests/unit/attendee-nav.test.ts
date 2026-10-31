import { describe, expect, it } from 'vitest';
import { landingPathForRoles } from '@/domain/identity/roles';
import { isNavItemCurrent, landingPathFor, resolveWorkingRole } from '@/domain/navigation/policy';
import { ROLE_NAV } from '@/domain/navigation/roleNav';

/**
 * SCRUM-255 Attendee Navigation. Test case IDs match the
 * ConnectSphere_TestCases_Sprint4 workbook, SCRUM-255 tab.
 * The redirect itself (login, then /) is tested by hand; the rendered header is
 * in attendee-nav-header.test.tsx and AC3's back link in
 * attendee-nav-back-links.test.tsx.
 */

describe('SCRUM-255 AC1: an Attendee lands on /register-events', () => {
  it('TC-255-01: an Attendee-only account lands on Open events, at login and from /', () => {
    // /login sends the browser to landingPathForRoles; / redirects to the working role's landing page.
    expect(landingPathForRoles(['attendee'])).toBe('/register-events');
    expect(landingPathFor(resolveWorkingRole(['attendee'], undefined))).toBe('/register-events');
  });

  it('TC-255-02: an account without the Attendee role does not', () => {
    expect(landingPathForRoles(['event_organiser'])).toBe('/events');
    expect(landingPathForRoles(['venue_staff'])).toBe('/booking-queue');
  });

  it('TC-255-03: Attendee with another role lands on that role, and reaches Open events through Working as (CL-56)', () => {
    const roles = ['attendee', 'event_organiser'] as const;

    // CL-56: the first role held in DEFAULT_ROLE_ORDER wins, and Attendee is last.
    expect(landingPathForRoles(roles)).toBe('/events');
    expect(landingPathFor(resolveWorkingRole(roles, 'attendee'))).toBe('/register-events');
  });
});

describe('SCRUM-255 AC2: the nav shows Open events', () => {
  it('TC-255-04: Open events and nothing else, highlighted on Open events and the event pages under it', () => {
    expect(ROLE_NAV.attendee).toEqual([{ href: '/register-events', label: 'Open events' }]);

    const current = (pathname: string) =>
      ROLE_NAV.attendee.filter((item) => isNavItemCurrent(pathname, item.href)).map((item) => item.label);

    expect(current('/register-events')).toEqual(['Open events']);
    expect(current('/register-events/abc')).toEqual(['Open events']);
    expect(current('/notifications')).toEqual([]);
  });

  it("TC-255-05: none of another role's items", () => {
    const otherLabels = Object.entries(ROLE_NAV)
      .filter(([role]) => role !== 'attendee')
      .flatMap(([, items]) => items.map((item) => item.label));

    expect(otherLabels.length).toBeGreaterThan(0);
    for (const label of otherLabels) {
      expect(ROLE_NAV.attendee.map((item) => item.label)).not.toContain(label);
    }
  });
});
