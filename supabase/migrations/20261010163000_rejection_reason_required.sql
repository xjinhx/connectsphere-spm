-- =============================================================================
-- SCRUM-244 Bug (SCRUM-148): a rejected booking request line with no reason
-- =============================================================================
-- venue_booking_request_line_reason_when_rejected (20261007090000) is meant to
-- make every rejected line carry a reason (SCRUM-148 AC5, SCRUM-149 AC2). Its
-- test, length(trim(rejection_reason)) > 0, comes out null when the reason is
-- null, and Postgres lets a check pass when it is null (only false fails). So
-- anything that bypasses the app could save a rejected line with no reason.
-- The app always requires one, so no acceptance criterion failed.
--
-- The check is replaced with one that also requires the reason to be there.
-- Rows written through the app already meet it.
-- =============================================================================

alter table venue_booking_request_line
  drop constraint venue_booking_request_line_reason_when_rejected,
  add constraint venue_booking_request_line_reason_when_rejected check (
    (status = 'rejected' and rejection_reason is not null and length(trim(rejection_reason)) > 0)
    or (status <> 'rejected' and rejection_reason is null)
  );
