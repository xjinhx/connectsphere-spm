-- =============================================================================
-- SCRUM-76 — interim: client organisation not yet available
-- =============================================================================
-- Authentication has landed; Client Organisations has not. Until it does there
-- is nothing to put in client_organisation_id, and NOT NULL would stop every
-- organiser from creating any request at all.
--
-- Relaxed here, deliberately and temporarily. The Client Organisations story
-- should backfill this column and reinstate NOT NULL (plus the foreign key)
-- in its own migration. SCRUM-76 AC1 - "form opens with my client
-- organisation pre-filled" - stays blocked until then.

alter table event_request
  alter column client_organisation_id drop not null;

comment on column event_request.client_organisation_id is
  'Nullable until the Client Organisations story lands; it should restore NOT NULL and add the FK.';
