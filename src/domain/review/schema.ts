import { z } from 'zod';

// Mirrors the database rule on the decision column. Lower case, matching the
// team's convention for stored values and the event_request_status enum.
// SCRUM-93 adds 'rejected' alongside its own migration.
export const DecisionSchema = z.enum(['approved']);
export type Decision = z.infer<typeof DecisionSchema>;

// The approving coordinator's id. The approve route fills it from the signed-in
// session (getCurrentActor), never from the request body, so a caller cannot
// record someone else as the decision maker. Still validated here so the
// service stays safe to call directly, as the integration tests do.
export const ApproveInputSchema = z.object({
  actorId: z.string().uuid(),
});
export type ApproveInput = z.infer<typeof ApproveInputSchema>;

// The id arrives from a URL. Postgres raises 22P02 on a malformed uuid, which
// would surface as a 500 for what is really just a bad link, so it is checked
// before any query runs. Same reasoning as UUID_PATTERN in
// domain/event-request/service.ts.
export const EventRequestIdSchema = z.string().uuid();
