import { z } from 'zod';

// Mirrors the database rule on the decision column. Upper case to match the
// status values SCRUM-82 established (DRAFT, SUBMITTED), so the table uses one
// spelling convention throughout.
// SCRUM-93 adds 'REJECTED' alongside its own migration.
export const DecisionSchema = z.enum(['APPROVED']);
export type Decision = z.infer<typeof DecisionSchema>;

// TODO(SCRUM-68): take the actor from the signed-in session once login lands,
// instead of trusting an ID sent in the request body.
export const ApproveInputSchema = z.object({
  actorId: z.string().uuid(),
});
export type ApproveInput = z.infer<typeof ApproveInputSchema>;

// The id arrives from a URL. Postgres raises 22P02 on a malformed uuid, which
// would surface as a 500 for what is really just a bad link, so it is checked
// before any query runs. Same reasoning as UUID_PATTERN in
// domain/event-request/service.ts.
export const EventRequestIdSchema = z.string().uuid();
