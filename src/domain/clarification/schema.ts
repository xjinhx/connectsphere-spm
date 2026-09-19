import { z } from 'zod';

/**
 * SCRUM-91 — Respond to a clarification request.
 *
 * Its own folder rather than an addition to domain/review/: that folder holds
 * the Coordinator's side of the exchange (SCRUM-89/90, raising a clarification
 * and reviewing a request). This is the Organiser's side, and keeping it apart
 * means neither story's file has to be edited to build the other — the same
 * separation domain/assignment/ has from domain/review/.
 */

/**
 * AC1 — "I amend it and resubmit". The amendment itself goes through the
 * existing draft save (SCRUM-83's PATCH), which already accepts a request in
 * Clarification Requested; this is the answer that travels with the resubmit.
 *
 * Trimmed before the length check, so a response of only whitespace is refused
 * the same as an empty one. Deliberately the same rule as SCRUM-90's
 * RequestClarificationInputSchema: a note and a reply are the two halves of one
 * exchange, and it would be odd if one accepted spaces and the other did not.
 */
export const ClarificationResponseInputSchema = z.object({
  response: z
    .string({ required_error: 'A response to the clarification is required' })
    .trim()
    .min(1, 'A response to the clarification is required'),
});
export type ClarificationResponseInput = z.infer<typeof ClarificationResponseInputSchema>;

/**
 * Ids arrive from a URL. Postgres raises 22P02 on a malformed uuid, which would
 * surface as a 500 for what is really just a bad link — so it is refused here
 * as a 404 instead. Same guard as EventRequestIdSchema in domain/assignment/.
 */
export const EventRequestIdSchema = z.string().uuid();
