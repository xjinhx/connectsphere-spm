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

/**
 * SCRUM-249 — the name each role is shown under in the header (account menu,
 * "Working as"). operations_manager is shown as Event Coordinator Lead, its
 * display name (customer #129); the role in code is unchanged.
 */
export const ROLE_LABELS: Record<Role, string> = {
  event_organiser: 'Event Organiser',
  coordinator: 'Event Coordinator',
  operations_manager: 'Event Coordinator Lead',
  venue_staff: 'Venue Staff',
  technical_support: 'Technical Support Staff',
  attendee: 'Attendee',
  safety_officer: 'Safety Officer',
};

/**
 * SCRUM-249 — which role an account starts in when it holds several (customer
 * clarification #56 allows that), highest first. Agreed with the PO, 22 Oct
 * 2026: the default no longer depends on the order roles are stored in, so an
 * account holding Technical Support Staff lands on /equipment-queue unless it
 * is also a Lead or Safety Officer (SCRUM-254 AC1). The Lead first and the
 * Safety Officer second keep SCRUM-232 AC1 and SCRUM-234 AC1 (Change Log
 * CL-27). The other roles are one click away in "Working as" (SCRUM-249 AC5).
 */
export const DEFAULT_ROLE_ORDER: readonly Role[] = [
  'operations_manager',
  'safety_officer',
  'technical_support',
  'venue_staff',
  'coordinator',
  'event_organiser',
  'attendee',
];

const FALLBACK_ROLE: Role = 'attendee';

export function isRole(value: unknown): value is Role {
  return RoleSchema.safeParse(value).success;
}

/**
 * SCRUM-249 — the role an account starts in: its highest role in
 * DEFAULT_ROLE_ORDER. Unrecognised values are ignored, and an account with no
 * recognised role falls back to Attendee.
 */
export function defaultRoleFor(roles: readonly unknown[] | undefined): Role {
  return DEFAULT_ROLE_ORDER.find((role) => roles?.includes(role)) ?? FALLBACK_ROLE;
}

/** The landing page of the role an account starts in (see defaultRoleFor). */
export function landingPathForRoles(roles: readonly unknown[] | undefined): string {
  return ROLE_LANDING_PATH[defaultRoleFor(roles)];
}
