import { z } from 'zod';

/**
 * SCRUM-94 — Assign an Event Coordinator to a submitted event.
 */

// Who is being put on the event. Sent in the request body: this is the
// manager's choice, and clarification #93 says the choice is theirs alone -
// their criteria live in an SOP outside the system, so nothing here judges it.
// Whether the person is actually a coordinator is checked in service.ts, which
// needs their profile anyway.
export const AssignCoordinatorInputSchema = z.object({
  coordinatorId: z.string().uuid(),
  // The Event Operations Manager making the assignment (AC1's "my name"). The
  // route fills this from the signed-in session, never from the body, so a
  // caller cannot record someone else as having made the call. Validated here
  // so the service stays safe to call directly, as the integration tests do.
  actorId: z.string().uuid(),
});
export type AssignCoordinatorInput = z.infer<typeof AssignCoordinatorInputSchema>;

// The id arrives from a URL. Postgres raises 22P02 on a malformed uuid, which
// would surface as a 500 for what is really just a bad link, so it is checked
// before any query runs. Same reasoning as domain/review/schema.ts.
export const EventRequestIdSchema = z.string().uuid();

// SCRUM-96 — reassign. The same two fields as assigning, plus the coordinator
// the manager is moving the event away from: the one they saw when they chose
// (the `current.id` that GET /coordinator returned). SCRUM-215: the service
// used to re-read the coordinator itself, so its guard only covered the
// milliseconds between its own read and write. A manager acting on a page that
// had gone stale would silently overwrite a reassignment made in the meantime.
// Sending what they saw lets the update refuse that, whatever the timing.
export const ReassignCoordinatorInputSchema = AssignCoordinatorInputSchema.extend({
  fromCoordinatorId: z.string().uuid(),
});
export type ReassignCoordinatorInput = z.infer<typeof ReassignCoordinatorInputSchema>;
