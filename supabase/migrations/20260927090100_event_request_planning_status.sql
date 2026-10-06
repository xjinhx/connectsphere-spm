-- =============================================================================
-- SCRUM-101 — Move an event through its statuses (AC3/AC4)
-- =============================================================================
-- Step 1 of 2 (own migration, per the two-step pattern already established by
-- 20260912154742_event_request_approved_status.sql and
-- 20260920140000_event_request_rejected_status.sql): add the 'planning'
-- status value, and nothing else. Postgres refuses to use a new enum value in
-- the same transaction that adds it, and each migration file runs in its own
-- transaction.
--
-- Only 'planning' is added here, matching SCRUM-101's actual Jira ACs (AC3:
-- Approved -> Planning on the first venue booking request; AC4: idempotent
-- while already Planning). Confirmed/Completed/Cancelled/Postponed/Withdrawn
-- are deliberately not added — no story on this sprint's board owns any of
-- those transitions yet. Same pattern as SCRUM-92/93: a value is added only
-- once a story actually needs it, not speculatively for a future one.

alter type event_request_status add value 'planning';
