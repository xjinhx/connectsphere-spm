import { z } from 'zod';

// Mirrors the database rule on the decision column. Lower case, matching the
// team's convention for stored values and the event_request_status enum.
// SCRUM-93 adds 'rejected' alongside its own migration.
export const DecisionSchema = z.enum(['approved']);
export type Decision = z.infer<typeof DecisionSchema>;

// TODO: take the actor from the signed-in session with getCurrentActor() once
// it is implemented on main. It still throws there; the working version is on
// the event-request branch (SCRUM-76). The middleware already refuses this
// endpoint without a signed-in user, so only *which* user is taken on trust.
export const ApproveInputSchema = z.object({
  actorId: z.string().uuid(),
});
export type ApproveInput = z.infer<typeof ApproveInputSchema>;

// The id arrives from a URL. Postgres raises 22P02 on a malformed uuid, which
// would surface as a 500 for what is really just a bad link, so it is checked
// before any query runs. Same reasoning as UUID_PATTERN in
// domain/event-request/service.ts.
export const EventRequestIdSchema = z.string().uuid();
