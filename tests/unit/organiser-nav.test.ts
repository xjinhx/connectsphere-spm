import { describe, expect, it } from 'vitest';
import { landingPathForRoles } from '@/domain/identity/roles';
import { currentNavHref, landingPathFor, resolveWorkingRole } from '@/domain/navigation/policy';
import { ROLE_NAV } from '@/domain/navigation/roleNav';

/**
 * SCRUM-250 Event Organiser Navigation. Test case IDs match the SCRUM-250 tab
 * of the Sprint 4 test case sheet. The rendered header is in
 * organiser-nav-header.test.tsx, AC3's back links in
 * event-request-pages.test.tsx, the folded phone menu in
 * tests/e2e/scrum-250-organiser-nav.spec.ts.
 */

describe('SCRUM-250 AC1: an Event Organiser lands on /events', () => {
  it('TC-250-01: at login and from /', () => {
    // /login sends the browser to landingPathForRoles; / redirects to the working role's landing page.
    expect(landingPathForRoles(['event_organiser'])).toBe('/events');
    expect(landingPathFor(resolveWorkingRole(['event_organiser'], undefined))).toBe('/events');
  });
});

describe('SCRUM-250 AC2: the nav shows Event requests, then New event request', () => {
  it('TC-250-02: the two items, in order, and nothing else', () => {
    expect(ROLE_NAV.event_organiser).toEqual([
      { href: '/events', label: 'Event requests' },
      { href: '/events/new', label: 'New event request' },
    ]);
  });

  it('TC-250-05: no other role gets either organiser item', () => {
    for (const [role, items] of Object.entries(ROLE_NAV)) {
      if (role === 'event_organiser') continue;
      const hrefs = items.map((item) => item.href);
      expect(hrefs).not.toContain('/events');
      expect(hrefs).not.toContain('/events/new');
    }
  });

  it("TC-250-07: only the current page's item is highlighted, the most specific one", () => {
    const items = ROLE_NAV.event_organiser;
    expect(currentNavHref('/events', items)).toBe('/events');
    expect(currentNavHref('/events/new', items)).toBe('/events/new');
    // A request and its edit page sit under Event requests (AC3).
    expect(currentNavHref('/events/abc', items)).toBe('/events');
    expect(currentNavHref('/events/abc/edit', items)).toBe('/events');
    // Not under either item: nothing is highlighted. A shared prefix alone
    // doesn't count (asked for by SCRUM-249's owner).
    expect(currentNavHref('/notifications', items)).toBeNull();
    expect(currentNavHref('/events-archive', items)).toBeNull();
  });

  it('TC-250-07 (regression, SCRUM-249 AC4): roles whose items do not nest are unchanged', () => {
    const items = ROLE_NAV.technical_support;
    expect(currentNavHref('/equipment', items)).toBe('/equipment');
    expect(currentNavHref('/equipment-queue', items)).toBe('/equipment-queue');
    expect(currentNavHref('/venues/abc/calendar', items)).toBe('/venues');
  });
});
