-- =============================================================================
-- SCRUM-93 — Reject a request (AC4)
-- =============================================================================
-- Step 1 of 2: add the 'rejected' status value, and nothing else.
--
-- Postgres refuses to use a new enum value in the same transaction that adds
-- it, and each migration file runs in its own transaction. Everything that
-- references 'rejected' therefore lives in the next migration. Same reasoning
-- as 20260912154742_event_request_approved_status.sql, which anticipated
-- this exact follow-up.

alter type event_request_status add value 'rejected';
