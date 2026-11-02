-- SCRUM-110 — Edit ordinary event information.
--
-- AC1: the assigned coordinator edits the description, internal notes, client
-- contact name, client contact email and client contact phone of an event that
-- is not Cancelled or Completed. `description` already exists (SCRUM-76); the
-- other four are new.
--
-- Internal notes are coordinator-only: they are read by their own query
-- (src/lib/supabase/eventInformation.ts) and are deliberately NOT in the shared
-- event_request select (src/lib/supabase/eventRequests.ts COLUMNS), so no
-- organiser-facing read can return them.
--
-- The client contact is per event, not the client organisation's own contact
-- (client_organisations.contact_*, SCRUM-203): the person to call for one event
-- can differ from the organisation's main contact.
--
-- All four are optional and stored as NULL when blank. Lengths are capped here
-- as a backstop; the readable rules (and the email format) are in
-- src/domain/event-information/schema.ts.

alter table event_request
  add column if not exists internal_notes text,
  add column if not exists client_contact_name text,
  add column if not exists client_contact_email text,
  add column if not exists client_contact_phone text;

alter table event_request
  add constraint event_request_internal_notes_length
    check (internal_notes is null or char_length(internal_notes) <= 2000),
  add constraint event_request_client_contact_name_length
    check (client_contact_name is null or char_length(client_contact_name) <= 200),
  add constraint event_request_client_contact_email_length
    check (client_contact_email is null or char_length(client_contact_email) <= 254),
  add constraint event_request_client_contact_phone_length
    check (client_contact_phone is null or char_length(client_contact_phone) <= 30);
