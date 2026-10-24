import { describe, expect, it } from 'vitest';
import { landingPathForRoles } from '@/domain/identity/roles';
import { isNavItemCurrent } from '@/domain/navigation/policy';
import { reviewBackLink } from '@/domain/navigation/reviewBackLink';
import { ROLE_NAV } from '@/domain/navigation/roleNav';

/**
 * SCRUM-251 Event Coordinator Navigation. Test case IDs match the SCRUM-251
 * tab of the Sprint 4 test case sheet. The rendered back links (AC4, AC6) are
 * in coordinator-nav-back-links.test.tsx; the real sign-in, nav and venue pages
 * (AC1, AC2, AC5) in tests/e2e/scrum-251-coordinator-nav.spec.ts.
 */

const COORDINATOR_NAV = [
  { href: '/assigned-events', label: 'Review queue' },
  { href: '/my-events', label: 'My events' },
  { href: '/venues', label: 'Venues' },
  { href: '/organisations', label: 'Client organisations' },
  { href: '/equipment', label: 'Equipment' },
];

describe('SCRUM-251 AC1: an Event Coordinator lands on /assigned-events', () => {
  it('TC-251-01: an Event Coordinator account lands on Review queue', () => {
    expect(landingPathForRoles(['coordinator'])).toBe('/assigned-events');
    expect(ROLE_NAV.coordinator[0]).toEqual({ href: '/assigned-events', label: 'Review queue' });
  });
});

describe('SCRUM-251 AC2: the nav shows the five items in order', () => {
  it('TC-251-02: Review queue, My events, Venues, Client organisations, Equipment, and nothing else', () => {
    expect(ROLE_NAV.coordinator).toEqual(COORDINATOR_NAV);
  });

  it('TC-251-02: each page highlights only its own item', () => {
    const current = (pathname: string) =>
      ROLE_NAV.coordinator.filter((item) => isNavItemCurrent(pathname, item.href)).map((item) => item.label);

    expect(current('/assigned-events')).toEqual(['Review queue']);
    expect(current('/my-events')).toEqual(['My events']);
    expect(current('/venues')).toEqual(['Venues']);
    expect(current('/organisations')).toEqual(['Client organisations']);
    expect(current('/equipment')).toEqual(['Equipment']);
    // AC5's and AC6's pages sit under their item, so it stays highlighted on them.
    expect(current('/venues/search')).toEqual(['Venues']);
    expect(current('/organisations/abc/edit')).toEqual(['Client organisations']);
  });

  it('TC-251-07: an Event Organiser gets none of the coordinator items', () => {
    const organiserHrefs = ROLE_NAV.event_organiser.map((item) => item.href);
    for (const item of COORDINATOR_NAV) expect(organiserHrefs).not.toContain(item.href);
  });

  it('TC-251-08: Technical Support Staff have their own nav, not the coordinator one', () => {
    expect(ROLE_NAV.technical_support).not.toEqual(ROLE_NAV.coordinator);
  });
});

describe('SCRUM-251 AC3: the review page links back to the list it came from', () => {
  it('TC-251-03: opened from Review queue, it links back to Review queue', () => {
    expect(reviewBackLink(undefined)).toEqual({ href: '/assigned-events', label: 'Review queue' });
  });

  it('TC-251-03: opened from My events, it links back to My events', () => {
    expect(reviewBackLink('my-events')).toEqual({ href: '/my-events', label: 'My events' });
  });

  it('TC-251-03: an unknown or repeated from goes back to Review queue', () => {
    expect(reviewBackLink('elsewhere')).toEqual({ href: '/assigned-events', label: 'Review queue' });
    expect(reviewBackLink(['my-events', 'my-events'])).toEqual({ href: '/assigned-events', label: 'Review queue' });
  });
});
