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