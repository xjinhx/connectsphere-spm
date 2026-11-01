import { z } from 'zod';

// Same convention as review/schema.ts's own EventRequestIdSchema: each
// domain validates the id shape locally rather than importing another
// domain's copy of the same one-liner.
export const EventRequestIdSchema = z.string().uuid();

/** SCRUM-105 AC1: the reason a coordinator gives for cancelling an event. */
export const CANCELLATION_REASON_MAX_LENGTH = 500;
export const CANCELLATION_REASON_REQUIRED = 'Give a reason for cancelling the event.';

export const CancelEventInputSchema = z.object({
  reason: z
    .string({ required_error: CANCELLATION_REASON_REQUIRED, invalid_type_error: CANCELLATION_REASON_REQUIRED })
    .trim()
    .min(1, CANCELLATION_REASON_REQUIRED)
    .max(CANCELLATION_REASON_MAX_LENGTH, `The reason must be ${CANCELLATION_REASON_MAX_LENGTH} characters or fewer.`),
});
export type CancelEventInput = z.infer<typeof CancelEventInputSchema>;
