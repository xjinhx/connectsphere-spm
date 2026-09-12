-- =============================================================================
-- SCRUM-92 — Approve a request so planning can proceed (AC1)
-- =============================================================================
-- Step 1 of 2: add the APPROVED status value, and nothing else.
--
-- Postgres refuses to use a new enum value in the same transaction that adds it
-- ("unsafe use of new value ... must be committed before they can be used"),
-- and each migration file runs in its own transaction. Everything that
-- references 'APPROVED' therefore lives in the next migration.
--
-- SCRUM-82 asked for the wider lifecycle to extend this enum rather than
-- replace it. SCRUM-93 adds 'REJECTED' the same way.

alter type event_request_status add value 'APPROVED';
