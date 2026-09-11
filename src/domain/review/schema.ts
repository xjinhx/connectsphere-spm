import { z } from 'zod';

// Mirrors the database rule on the decision column.
// SCRUM-93 adds 'rejected' alongside its own migration.
export const DecisionSchema = z.enum(['approved']);
export type Decision = z.infer<typeof DecisionSchema>;

// TODO(SCRUM-68): take the actor from the signed-in session once login lands,
// instead of trusting an ID sent in the request body.
export const ApproveInputSchema = z.object({
  actorId: z.string().uuid(),
});
export type ApproveInput = z.infer<typeof ApproveInputSchema>;
