-- =============================================================================
-- SCRUM-204 — Link an Event Organiser to a client organisation
-- =============================================================================
-- AC1: a membership an Event Organiser's account can be assigned to and hold.
-- Nullable, not backfilled: an existing organiser account has no organisation
-- to default to, and AC2 explicitly covers the "not yet linked" case rather
-- than assuming one.

alter table profiles
  add column client_organisation_id uuid references client_organisations (id) on delete set null;
