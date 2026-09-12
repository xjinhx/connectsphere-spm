import { z } from 'zod';

export const RoleSchema = z.enum([
  'event_organiser',
  'coordinator',
  'operations_manager',
  'venue_staff',
  'technical_support',
  'attendee',
]);
export type Role = z.infer<typeof RoleSchema>;

export const AccountRolesSchema = z.object({
  accountId: z.string().uuid(),
  roles: z.array(RoleSchema).min(1, 'An account must hold at least one role.'),
});
export type AccountRoles = z.infer<typeof AccountRolesSchema>;

export const ROLE_LANDING_PATH: Record<Role, string> = {
  event_organiser: '/events',
  coordinator: '/assigned-events',
  operations_manager: '/assignment-queue',
  venue_staff: '/booking-queue',
  technical_support: '/equipment-queue',
  attendee: '/register-events',
};

const DEFAULT_ROLE: Role = 'attendee';

export function isRole(value: unknown): value is Role {
  return RoleSchema.safeParse(value).success;
}

/**
 * An account can hold multiple roles (see AccountRolesSchema); login only
 * needs one landing page, so the first role in the account's list wins.
 * Falls back to the Attendee landing page when the list is empty or unset.
 */
export function landingPathForRoles(roles: readonly unknown[] | undefined): string {
  const firstKnownRole = roles?.find(isRole);
  return ROLE_LANDING_PATH[firstKnownRole ?? DEFAULT_ROLE];
}
