import { defaultRoleFor, ROLE_LANDING_PATH, type Role } from '@/domain/identity/roles';
import { ForbiddenError } from '@/domain/shared/errors';
import type { AccountDisplay } from './schema';

/**
 * SCRUM-249 — the rules behind the shared header. Pure functions only; the
 * cookie and session are read in src/lib/auth/signedInAccount.ts.
 */

/**
 * AC5 — the cookie holding the role chosen in "Working as". Cleared on login
 * and logout, so every login starts on the default role (PO, 22 Oct 2026), and
 * kept until then, so the choice survives a reload.
 */
export const WORKING_AS_COOKIE = 'csp_working_as';

/**
 * AC5 — the role the header and landing page are shown for: the one chosen in
 * "Working as" if the account holds it, otherwise the default role
 * (defaultRoleFor). A cookie naming a role the account no longer holds is
 * ignored rather than trusted.
 */
export function resolveWorkingRole(roles: readonly Role[], chosen: unknown): Role {
  const held = roles.find((role) => role === chosen);
  return held ?? defaultRoleFor(roles);
}

/**
 * AC5 — refuse switching to a role the account does not hold. Switching only
 * changes the landing page and nav; the API still allows every action of every
 * role the account holds (SCRUM-206 AC2, PO 22 Oct 2026), so this is the only
 * check "Working as" needs.
 */
export function assertCanWorkAs(roles: readonly Role[], role: Role): void {
  if (!roles.includes(role)) {
    throw new ForbiddenError('Your account does not hold that role.');
  }
}

/** AC1, AC3 — "my landing page": the landing page of the role being worked as. */
export function landingPathFor(workingRole: Role): string {
  return ROLE_LANDING_PATH[workingRole];
}

/**
 * AC4 — a nav item is highlighted on its own page and on every page under it
 * (PO, 22 Oct 2026): '/venues' is current on '/venues/<id>/calendar'. A
 * shared prefix alone is not enough: '/events' is not current on
 * '/events-archive'.
 */
export function isNavItemCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * AC2 — the account menu shows the name and email. With no name recorded
 * (most seeded accounts), the email is shown once in its place (PO, 22 Oct
 * 2026), never "null" or a blank line.
 */
export function accountDisplay(fullName: string | null | undefined, email: string): AccountDisplay {
  const name = fullName?.trim();
  return name ? { primary: name, secondary: email } : { primary: email, secondary: null };
}
