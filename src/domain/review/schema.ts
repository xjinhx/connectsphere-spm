import { z } from 'zod';

// Mirrors the database rule on the decision column. Lower case, matching the
// team's convention for stored values and the event_request_status enum.
// SCRUM-93 added 'rejected' alongside its own migration
// (20260920140100_event_request_rejection_decision.sql).
export const DecisionSchema = z.enum(['approved', 'rejected']);
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

// ---------------------------------------------------------------------------
// SCRUM-93 — Reject a request
// ---------------------------------------------------------------------------

/**
 * AC5 — "Given I attempt to reject a request without entering a reason, when
 * I submit, then the rejection is blocked and I am told a reason is
 * required." Trimmed before the length check, same reasoning as
 * RequestClarificationInputSchema: a reason of only whitespace is refused the
 * same as an empty one.
 */
export const RejectInputSchema = z.object({
  reason: z
    .string({ required_error: 'A reason is required to reject this request' })
    .trim()
    .min(1, 'A reason is required to reject this request'),
});
export type RejectInput = z.infer<typeof RejectInputSchema>;
