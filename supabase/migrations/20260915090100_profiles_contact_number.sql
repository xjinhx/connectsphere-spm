-- =============================================================================
-- SCRUM-98 - See who my coordinator is
-- =============================================================================
-- AC1: "the coordinator's full name, ConnectSphere email address and contact
-- number are displayed". Full name is profiles.full_name and the email is the
-- account's own address in Supabase Auth, but nothing stored a contact number.
--
-- This adds only the column. Letting people enter or change their number is
-- SCRUM-205 (Maintain my profile details), which is deferred out of Sprint 1,
-- so until that lands the value is set directly (seed data or Studio) and the
-- event page shows "Not recorded" when it is empty.
-- =============================================================================

alter table profiles
  add column if not exists contact_number text
    -- Loose on purpose: format rules belong to SCRUM-205, which owns entry.
    -- This only refuses blank strings, so "not recorded" has one spelling: null.
    check (contact_number is null or length(trim(contact_number)) between 1 and 30);
