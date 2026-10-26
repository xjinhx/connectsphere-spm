-- =============================================================================
-- SCRUM-187 AC1 — widen the selectable field set to the full event request
-- =============================================================================
-- PO clarification, 24 Oct 2026 (CL-61): any field the organiser fills in on
-- the event request form can be selected, not only the SCRUM-111/190
-- "significant" subset 20261024090000_change_request.sql started with. Adds
-- the remaining event-request core fields: name, purpose, description,
-- registrationRequired.
-- =============================================================================

alter table change_request_field
  drop constraint change_request_field_known;

alter table change_request_field
  add constraint change_request_field_known check (field in (
    'name',
    'purpose',
    'description',
    'proposedDate',
    'startTime',
    'endTime',
    'expectedAttendance',
    'roomLayout',
    'accessibilityRequired',
    'accessibilityFeatureIds',
    'accessibilityNotes',
    'preferredLocationId',
    'equipmentRequired',
    'equipmentItems',
    'technicalSupportNotes',
    'registrationRequired'
  ));
