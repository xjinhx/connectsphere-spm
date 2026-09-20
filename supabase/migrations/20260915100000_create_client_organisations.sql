-- =============================================================================
-- SCRUM-203 — Create and maintain a client organisation
-- =============================================================================
-- AC1/AC2: a Coordinator creates an organisation with a unique name and
-- contact details. The unique constraint is on the trimmed name so "Acme"
-- and "Acme " cannot both be saved; case is left alone (Postgres default),
-- matching how event_request.name is guarded (see 20260911000000).

create table client_organisations (
  id uuid primary key default gen_random_uuid(),

  name text not null unique,
  contact_name text,
  contact_email text,
  contact_phone text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint client_organisations_name_not_blank check (btrim(name) <> '')
);

-- Reuses the trigger function created in 20260911000000_event_request.sql.
create trigger client_organisations_set_updated_at
  before update on client_organisations
  for each row execute function set_updated_at();

-- Same posture as event_request: deny-by-default RLS, reads/writes go through
-- the service layer using the service-role key.
alter table client_organisations enable row level security;

-- Backfills the foreign key that event_request.client_organisation_id has
-- been waiting on since 20260912000000_event_request_organisation_nullable.sql.
-- NOT NULL is deliberately left as-is: reinstating it requires every existing
-- event_request row (and every organiser account) to have a client
-- organisation to point at, which needs the organiser-to-organisation
-- linkage this ticket's ACs do not cover. That backfill is a follow-up, not
-- part of SCRUM-203.
alter table event_request
  add constraint event_request_client_organisation_id_fkey
  foreign key (client_organisation_id) references client_organisations (id) on delete restrict;
