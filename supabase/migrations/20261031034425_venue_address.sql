-- =============================================================================
-- SCRUM-180 — Browse open events and see my registrations
-- =============================================================================
-- AC3: an event's page shows the "venue name and address". No address is
-- stored for a venue yet, so this adds one. venues is a shared table; any
-- story that needs a column may add it (CLAUDE.md, Dependencies).
--
-- Nullable: existing venues have none, and setting it in the venue catalogue
-- form is not in this story. Until it is, seed.sql sets it for the seeded
-- venues, and a venue without one shows its name only.
-- =============================================================================

alter table venues
  add column address text;

alter table venues
  -- Blank is the same as not set: store null rather than ''.
  add constraint venues_address_not_blank check (address is null or btrim(address) <> '');
