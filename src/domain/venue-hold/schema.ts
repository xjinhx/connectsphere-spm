import { z } from 'zod';
import { isISODate } from '@/domain/shared/dates';
import { ClockRangeSchema } from '@/domain/shared/times';

/**
 * Venue holds (EP-37, Tentative Venue Holding): data shapes shared by the API
 * route and the UI.
 *
 * SCRUM-227 Hold a venue until an expiry
 *
 * A hold (CONTEXT.md) keeps one period at one venue for one event until an
 * expiry, so the coordinator can finish arranging the booking without the
 * venue being taken, and without it being held forever. Values mirror the
 * check constraints in supabase/migrations/20261010130000_venue_hold.sql.
 */

/** Only these events can be held: the same rule as a booking request (SCRUM-142 AC1, AC2). */
export const HOLDABLE_EVENT_STATUSES = ['approved', 'planning'] as const;

/** AC2's message, for an expiry that is missing, unreadable or not in the future. */
export const FUTURE_EXPIRY_REQUIRED = 'A future expiry date and time is required.';

/**
 * AC1: "I choose an event, a venue, a date, a start and end time and an expiry
 * date and time". The venue comes from the URL.
 *
 * Start and end are checked by the shared ClockRangeSchema, so the 15-minute
 * rule is the same one every other time input uses (SCRUM-238, 239). The
 * expiry is a Singapore date and time, `YYYY-MM-DDTHH:MM`, as a
 * datetime-local input sends it; whether it is in the future is AC2's check,
 * made in the service against the time of the save.
 */
export const CreateVenueHoldInputSchema = z
  .object({
    eventRequestId: z.string({ required_error: 'Choose an event.' }).uuid('Choose an event from the list.'),
    date: z.string({ required_error: 'Choose a date.' }).refine(isISODate, 'Choose a valid date.'),
    start: z.string({ required_error: 'Choose a start time.' }),
    end: z.string({ required_error: 'Choose an end time.' }),
    expiresAt: z.string().trim().optional(),
  })
  .superRefine((input, ctx) => {
    const range = ClockRangeSchema.safeParse({ start: input.start, end: input.end });
    if (!range.success) range.error.issues.forEach((issue) => ctx.addIssue(issue));
  });
export type CreateVenueHoldInput = z.infer<typeof CreateVenueHoldInputSchema>;

/**
 * Where a hold stands at a given moment:
 * - `active`: committing its period until its expiry (AC1).
 * - `closed`: its event's booking for the period was confirmed (AC5).
 * - `lapsed`: its expiry passed first; it commits nothing (AC6).
 */
export const HOLD_STATES = ['active', 'closed', 'lapsed'] as const;
export type HoldState = (typeof HOLD_STATES)[number];

/** One hold as the API and the venue page show it. Venue Staff see which event holds it. */
export const VenueHoldSchema = z.object({
  id: z.string().uuid(),
  venueId: z.string().uuid(),
  event: z.object({ id: z.string().uuid(), reference: z.string(), name: z.string() }),
  date: z.string(),
  start: z.string(),
  end: z.string(),
  /** An ISO instant. */
  expiresAt: z.string(),
  state: z.enum(HOLD_STATES),
  createdAt: z.string(),
});
export type VenueHold = z.infer<typeof VenueHoldSchema>;

/** One event the hold form offers. */
export const HoldableEventSchema = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  name: z.string(),
});
export type HoldableEvent = z.infer<typeof HoldableEventSchema>;
