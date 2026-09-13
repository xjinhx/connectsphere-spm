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

// ---------------------------------------------------------------------------
// SCRUM-90 — Request clarification from the Event Organiser
// ---------------------------------------------------------------------------

/**
 * AC3 — "Given I attempt to request clarification without entering a note,
 * when I submit, then the action is blocked and I am told a note is
 * required." Trimmed before the length check, so a note of only whitespace is
 * refused the same as an empty one — a caller cannot satisfy "a note" by
 * sending spaces.
 */
export const RequestClarificationInputSchema = z.object({
  note: z
    .string({ required_error: 'A note describing what is needed is required' })
    .trim()
    .min(1, 'A note describing what is needed is required'),
});
export type RequestClarificationInput = z.infer<typeof RequestClarificationInputSchema>;
