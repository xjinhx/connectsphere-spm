-- =============================================================================
-- SCRUM-234 — Run the Operational Safety Check: the role and the status
-- =============================================================================
-- "As a Safety Officer, I want to run the operational safety check on a
-- Confirmed event, so that it only moves into preparation once it is safe to
-- run."
--
-- The card names a role and a status the database does not have yet: the
-- Safety Officer (AC1, AC6) and Preparation (AC3, AC5). This adds them, and
-- nothing else. The check itself is the next file,
-- 20261018193100_operational_safety_check.sql.
--
-- Nothing may *use* the new status in this file: Postgres refuses a new enum
-- value in the same transaction that adds it (see
-- 20260912154742_event_request_approved_status.sql), which is why the check is
-- a second file.
--
-- None of event_request's check constraints needs restating: Preparation is
-- past submission, so it carries a submitted_at and keeps its approval
-- decision, the same reasoning as 20260928120000 for Planning and Confirmed.
-- =============================================================================

alter type event_request_status add value if not exists 'preparation';

-- The same list as RoleSchema in src/domain/identity/roles.ts, plus the new
-- role. A check constraint cannot be altered in place, so it is replaced.
alter table profiles drop constraint valid_roles;

alter table profiles
  add constraint valid_roles check (
    roles <@ array[
      'event_organiser',
      'coordinator',
      'operations_manager',
      'venue_staff',
      'technical_support',
      'attendee',
      'safety_officer'
    ]::text[]
  );
