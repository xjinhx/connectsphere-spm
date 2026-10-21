import { z } from 'zod';
import { RoleSchema } from '@/domain/identity/roles';

/**
 * SCRUM-249 — the shared header's shapes.
 *
 * PROPOSAL for the Role Navigation stories (SCRUM-250 to 256): each one adds
 * its role's items to ROLE_NAV (roleNav.ts) as NavItems. Extend this file
 * rather than adding another nav shape.
 */

/** One link in the nav bar. `href` is a page path, e.g. '/equipment-queue'. */
export const NavItemSchema = z.object({
  href: z.string().startsWith('/'),
  label: z.string().min(1),
});
export type NavItem = z.infer<typeof NavItemSchema>;

/** SCRUM-249 AC5 — the body of POST /api/me/working-as. */
export const WorkingAsInputSchema = z.object({
  role: RoleSchema,
});
export type WorkingAsInput = z.infer<typeof WorkingAsInputSchema>;

/** SCRUM-249 AC2 — how the signed-in account is shown in the account menu. */
export interface AccountDisplay {
  /** The name, or the email when no name is recorded. */
  primary: string;
  /** The email under the name; null when `primary` already is the email. */
  secondary: string | null;
}
