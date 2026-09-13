import { z } from 'zod';

/**
 * SCRUM-204 — the client organisation membership held against an Event
 * Organiser account. `clientOrganisationId` is nullable: AC2 covers the
 * "not yet linked" case explicitly, so unassigning is a valid state too.
 */
export const AssignOrganisationInputSchema = z.object({
  clientOrganisationId: z.string().uuid().nullable(),
});
export type AssignOrganisationInput = z.infer<typeof AssignOrganisationInputSchema>;

export const AccountOrganisationSchema = z.object({
  accountId: z.string().uuid(),
  clientOrganisationId: z.string().uuid().nullable(),
});
export type AccountOrganisation = z.infer<typeof AccountOrganisationSchema>;
