import { describe, expect, it } from 'vitest';
import { landingPathForRoles } from '@/domain/identity/roles';
import { currentNavHref } from '@/domain/navigation/policy';
import { ROLE_NAV } from '@/domain/navigation/roleNav';

/**
 * SCRUM-256 Safety Officer Navigation, AC1 and AC2. The app's route is
 * /safety-checks (built by SCRUM-234); the card's /safety-queue is a wording
 * to be corrected. Test case IDs match the SCRUM-256 tab of the Sprint 4
 * sheet. AC3's pages are in safety-officer-nav-links.test.tsx.
 */

describe('SCRUM-256 AC1: a Safety Officer lands on Safety checks', () => {
  it('TC-256-01: a Safety Officer account lands on /safety-checks', () => {
    expect(landingPathForRoles(['safety_officer'])).toBe('/safety-checks');
  });

  it('TC-256-04: a coordinator who is also a Safety Officer lands on /safety-checks, whichever is stored first', () => {
    expect(landingPathForRoles(['coordinator', 'safety_officer'])).toBe('/safety-checks');
    expect(landingPathForRoles(['safety_officer', 'coordinator'])).toBe('/safety-checks');
  });

  it("TC-256-05: a Lead who is also a Safety Officer lands on the Lead's page", () => {
    expect(landingPathForRoles(['safety_officer', 'operations_manager'])).toBe('/assignment-queue');
  });
});

describe('SCRUM-256 AC2: the nav shows Safety checks', () => {
  it('TC-256-06: the nav is exactly Safety checks, linking to /safety-checks', () => {
    expect(ROLE_NAV.safety_officer).toEqual([{ href: '/safety-checks', label: 'Safety checks' }]);
  });

  it('TC-256-07: Safety checks is highlighted on its own page', () => {
    expect(currentNavHref('/safety-checks', ROLE_NAV.safety_officer)).toBe('/safety-checks');
  });

  it('TC-256-14: Safety checks stays highlighted on a check page, and not on pages outside it', () => {
    expect(currentNavHref('/safety-checks/abc', ROLE_NAV.safety_officer)).toBe('/safety-checks');
    expect(currentNavHref('/notifications', ROLE_NAV.safety_officer)).toBeNull();
  });
});
