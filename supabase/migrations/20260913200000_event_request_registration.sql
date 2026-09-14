-- =============================================================================
-- SCRUM-81 — Indicate whether attendee registration is required
-- =============================================================================
-- One answer, same three states as the accessibility and equipment answers:
--   NULL  - not yet answered
--   true  - registration is required (AC1)
--   false - not required (AC2/AC3)
--
-- AC2's "no registration settings are recorded": Attendee Registration is not
-- in this sprint, so this flag is the only registration setting that exists.
-- The story that adds registration set-up should key off `true` here.
--
-- AC3's "any registration flag previously stored is cleared": every save
-- writes this column from the form, so unmarking overwrites a stored true.
alter table event_request
  add column registration_required boolean;
