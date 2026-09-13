-- =============================================================================
-- SCRUM-90 — Request clarification from the Event Organiser (AC1)
-- =============================================================================
-- Step 1 of 2: add the 'clarification_requested' status value, and nothing
-- else.
--
-- Postgres refuses to use a new enum value in the same transaction that adds
-- it ("unsafe use of new value ... must be committed before they can be
-- used"), and each migration file runs in its own transaction. Everything
-- that references 'clarification_requested' therefore lives in the next
-- migration. Same split as 20260912154742_event_request_approved_status.sql.
--
-- Lower case, matching the team's convention for stored values.

alter type event_request_status add value 'clarification_requested';
