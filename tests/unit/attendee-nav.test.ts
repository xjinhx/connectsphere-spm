import { describe, expect, it } from 'vitest';
import { landingPathForRoles } from '@/domain/identity/roles';
import { landingPathFor, resolveWorkingRole } from '@/domain/navigation/policy';

/**
 * SCRUM-255 Attendee Navigation. Test case IDs match SCRUM-255-test-cases.xlsx.
 * The redirect itself (login, then /) is tested by hand.
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
