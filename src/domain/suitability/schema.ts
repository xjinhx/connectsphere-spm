import { z } from 'zod';

/**
 * Venue Suitability Checking (EP-11, SCRUM-15): data shapes shared by the API
 * route and the UI.
 *
 * SCRUM-136 Flag a venue whose capacity is exceeded
 *
 * A suitability check compares one venue against one event's requirements and
 * gives exactly one verdict (customer clarification #83).
 */

/**
 * SCRUM-136 AC1 and AC3 (and SCRUM-135 AC1, which defines all three):
 * - `suitable`: every requirement checked is recorded on both sides and met.
 * - `suitable_with_concerns`: nothing is breached, but at least one
 *   requirement or venue attribute is not recorded, so it cannot be verified.
 * - `not_suitable`: at least one recorded requirement is breached.
 */
export const VERDICTS = ['suitable', 'suitable_with_concerns', 'not_suitable'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const VERDICT_LABELS: Record<Verdict, string> = {
  suitable: 'Suitable',
  suitable_with_concerns: 'Suitable with concerns',
  not_suitable: 'Not suitable',
};

/** How one requirement came out: met, breached, or unverifiable because something is not recorded. */
export const OUTCOMES = ['met', 'not_met', 'unverified'] as const;
export type Outcome = (typeof OUTCOMES)[number];

/**
 * One requirement checked, with the event's requirement and the venue's value
 * side by side (SCRUM-135 AC2), and what is wrong with it if anything (SCRUM-136
 * AC1: "the shortfall of 30 is stated"; AC3: "expected attendance is named as
 * the unverified item").
 */
export const RequirementResultSchema = z.object({
  requirement: z.literal('capacity'),
  label: z.string(),
  outcome: z.enum(OUTCOMES),
  eventValue: z.string(),
  venueValue: z.string(),
  /** Null when the requirement is met. */
  detail: z.string().nullable(),
  /** SCRUM-136 AC1: by how many attendees the venue falls short; null unless not met. */
  shortfall: z.number().int().positive().nullable(),
});
export type RequirementResult = z.infer<typeof RequirementResultSchema>;

/** A check of one venue against one event, or against one of its booking requests (AC5). */
export const SuitabilityResultSchema = z.object({
  eventRequestId: z.string().uuid(),
  /** SCRUM-136 AC5: the booking request checked for; null when the venue is checked against the event. */
  bookingRequestId: z.string().uuid().nullable(),
  venue: z.object({ id: z.string().uuid(), name: z.string() }),
  verdict: z.enum(VERDICTS),
  requirements: z.array(RequirementResultSchema),
});
export type SuitabilityResult = z.infer<typeof SuitabilityResultSchema>;

/**
 * "When suitability is checked": a venue, checked against the event (AC1 to
 * AC4), or one of the event's booking requests, checked for that request at
 * its own venue (AC5). Exactly one of the two. The event comes from the URL.
 */
export const CheckSuitabilityInputSchema = z
  .object({
    venueId: z.string().uuid('Choose a venue from the list.').optional(),
    bookingRequestId: z.string().uuid('Choose a booking request from the list.').optional(),
  })
  .refine((input) => (input.venueId === undefined) !== (input.bookingRequestId === undefined), {
    message: 'Choose a venue, or one of the booking requests.',
  });
