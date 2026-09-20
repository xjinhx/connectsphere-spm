import { z } from 'zod';

/**
 * Client Organisations (SCRUM-203): data shapes shared by the API routes and
 * the UI. Mirrors the constraints in
 * supabase/migrations/20260915100000_create_client_organisations.sql.
 */

export const ClientOrganisationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ClientOrganisation = z.infer<typeof ClientOrganisationSchema>;

/** AC1 — name and contact details. Contact fields are optional on input. */
export const CreateClientOrganisationInputSchema = z.object({
  name: z.string().trim().min(1, 'Organisation name is required.'),
  contactName: z.string().trim().min(1).optional(),
  contactEmail: z.string().trim().email('Enter a valid email address.').optional(),
  contactPhone: z.string().trim().min(1).optional(),
});
export type CreateClientOrganisationInput = z.infer<typeof CreateClientOrganisationInputSchema>;

/**
 * "create and update a client organisation record" (story description) — the
 * same shape as create. Name is still required: an update clears a contact
 * field by omitting it, but never blanks the name itself.
 */
export const UpdateClientOrganisationInputSchema = CreateClientOrganisationInputSchema;
export type UpdateClientOrganisationInput = z.infer<typeof UpdateClientOrganisationInputSchema>;

/** AC3 — an event recorded against the organisation, as shown on its page. */
export const OrganisationEventSummarySchema = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  name: z.string(),
  status: z.enum(['draft', 'submitted']),
  proposedDate: z.string().nullable(),
});
export type OrganisationEventSummary = z.infer<typeof OrganisationEventSummarySchema>;

export const ClientOrganisationDetailSchema = ClientOrganisationSchema.extend({
  events: z.array(OrganisationEventSummarySchema),
});
export type ClientOrganisationDetail = z.infer<typeof ClientOrganisationDetailSchema>;
