import { z } from 'zod';

export const RoleSchema = z.enum([
  'event_organiser',
  'coordinator',
  'operations_manager',
  'venue_staff',
  'technical_support',
  'attendee',
  // SCRUM-234 — runs the operational safety check on a Confirmed event.
  'safety_officer',
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
  safety_officer: '/safety-checks',
};

const DEFAULT_ROLE: Role = 'attendee';

export function isRole(value: unknown): value is Role {
  return RoleSchema.safeParse(value).success;
}

/**
 * An account can hold multiple roles (see AccountRolesSchema; customer
 * clarification #56); login only needs one landing page, so the first role in
 * the account's list wins.
 *
 * SCRUM-232 AC1 — except the Event Coordinator Lead (operations_manager): an
 * account holding it lands on the unassigned queue wherever the role sits in
 * the list, so a Lead who is also a Coordinator is not sent to their own
 * assigned events first.
 *
 * SCRUM-234 AC1 — the same for the Safety Officer: an account holding the role
 * lands on the safety check list wherever it sits in the list. The Lead's rule
 * is checked first, so an account holding both keeps SCRUM-232's landing page
 * (no card says otherwise).
 *
 * Falls back to the Attendee landing page when the list is empty or unset.
 */
export function landingPathForRoles(roles: readonly unknown[] | undefined): string {
  if (roles?.includes('operations_manager')) return ROLE_LANDING_PATH.operations_manager;
  if (roles?.includes('safety_officer')) return ROLE_LANDING_PATH.safety_officer;
  const firstKnownRole = roles?.find(isRole);
  return ROLE_LANDING_PATH[firstKnownRole ?? DEFAULT_ROLE];
}
