-- =============================================================================
-- SCRUM-103 — Prevent invalid status transitions
-- =============================================================================
-- The card's ACs name four statuses the enum does not have yet: Planning,
-- Confirmed, Completed (AC1, AC3, AC4) and Cancelled (AC3). This adds them,
-- and nothing else.
--
-- Planning is SCRUM-101's status: its branch adds it in
-- 20260927090000_event_request_planning_status.sql, not yet on main. This
-- story needs it now, so it adds it too, with IF NOT EXISTS, and this file is
-- timestamped after SCRUM-101's so a fresh reset runs theirs first. Either can
-- merge first and a fresh reset still works.
-- DUMMY(SCRUM-101) D-10: 'planning' added here until SCRUM-101's migration is on main.
--
-- Which moves between statuses are allowed is not stored here: it is the table
-- in src/domain/event-status/policy.ts, applied by changeEventStatus
-- (src/domain/event-status/service.ts), whose update is guarded on the status
-- it read. Same split as approve/reject (SCRUM-92/93): the rule is readable in
-- policy.ts, the guard is inside the UPDATE. The Sprint 1 actions (submit,
-- approve, reject, clarify, resubmit) still write their own status through
-- their own guarded updates; they do not go through changeEventStatus.
--
-- Nothing may *use* the new values in this file: Postgres refuses a new enum
-- value in the same transaction that adds it (see
-- 20260912154742_event_request_approved_status.sql).
--
-- None of the existing check constraints needs restating:
--   * event_request_submitted_at_matches_status - every new status is past
--     submission, so each carries a submitted_at, like approved does.
--   * event_request_assignment_needs_submission - same reasoning.
--   * the decision constraints only look at approved/rejected, and an event
--     keeps its approval decision as it moves on to planning and beyond.

alter type event_request_status add value if not exists 'planning';
alter type event_request_status add value 'confirmed';
alter type event_request_status add value 'completed';
alter type event_request_status add value 'cancelled';
