import type { EventRequestStatus } from '@/domain/event-request/schema';

/**
 * SCRUM-142 — Submit a venue booking request for an event.
 *
 * AC1 (Jira, updated 29/9/2026): "Given I am the assigned coordinator of an
 * event that is Approved or in Planning, when I submit a booking request...
 * then the request is created with status Pending...". This is now the
 * confirmed card text, not an inference — the update settles the exact
 * question flagged below when this was first written.
 *
 * Only 'approved' is accepted here regardless, for a reason that hasn't
 * changed: SCRUM-101 (Move an event through its statuses) is what adds the
 * 'planning' status and its own canEnterPlanning(status) rule
 * (src/domain/event-status/policy.ts), and as this is written that ticket
 * is still on the unmerged `move-event-status` branch — 'planning' does not
 * exist in EventRequestStatus on this branch or on main yet, so it cannot
 * be referenced here without failing to compile.
 *
 * IMPORTANT for whoever next touches this, once SCRUM-101 merges to main:
 * change this function to call canEnterPlanning(status) instead of checking
 * 'approved' alone — not to a local status === 'approved' || status ===
 * 'planning' check, which would duplicate a rule SCRUM-101 already owns.
 * Do not add 'planning' to the enum from this ticket's migration —
 * SCRUM-101 already does that, and adding it twice will fail the second
 * migration.
 *
 * Scope note (also confirmed 29/9/2026): this ticket's job stops at
 * creating the Pending request and being ready to trigger SCRUM-101's
 * transition (see DUMMY(SCRUM-101) D-09 in service.ts) — it does not cover
 * how the resulting status is displayed (SCRUM-99, "See the current status
 * of an event") or the Venue Staff-facing queue page itself (SCRUM-147,
 * "View the pending booking request queue"). Both are separate tickets;
 * this one only needs the row to exist and be readable by that role.
 */
export function canCreateBookingRequest(status: EventRequestStatus): boolean {
  return status === 'approved';
}
