import type { EventRequestStatus } from '@/domain/event-request/schema';

/**
 * SCRUM-142 — Submit a venue booking request for an event.
 *
 * AC2 — "Given an event has not been approved, when I attempt to create a
 * booking request, then the action is refused." Only 'approved' is accepted
 * here, not also 'planning'.
 *
 * IMPORTANT for whoever next touches this: SCRUM-101 (Move an event through
 * its statuses) adds a 'planning' status and its own canEnterPlanning(status)
 * rule (src/domain/event-status/policy.ts), but as this is written that
 * ticket is still on the unmerged `move-event-status` branch, so 'planning'
 * does not exist in EventRequestStatus on this branch or on main yet.
 *
 * SCRUM-101's own AC4 ("Given an event is already in Planning, when a
 * further [venue booking] request is raised against it, then the status
 * remains Planning") only makes sense if a *second* venue booking request
 * against an already-Planning event is actually creatable — otherwise
 * there would never be a "further request" for AC4 to describe. So once
 * SCRUM-101 merges to main, this function should change to call
 * canEnterPlanning(status) instead of checking 'approved' alone — not to a
 * local status === 'approved' || status === 'planning' check, which would
 * duplicate a rule SCRUM-101 already owns. Flagged in the PR description;
 * do not add 'planning' to the enum from this ticket's migration — SCRUM-101
 * already does that, and adding it twice will fail the second migration.
 */
export function canCreateBookingRequest(status: EventRequestStatus): boolean {
  return status === 'approved';
}
