-- =============================================================================
-- SCRUM-76 — Create an event request with basic details
-- =============================================================================
-- Shared table for US-5.1 (SCRUM-76 + 77 + 78). Created once here with
-- SCRUM-76's columns populated; time_slots (77) and expected_attendance (78)
-- are present as nullable placeholders so the table matches the agreed
-- eventRequestCoreSchema shape, but carry no rules or UI until their own
-- tickets add them. status/submit belong to SCRUM-82 and are not here.

-- AC2 asks for a unique reference. A sequence is the only thing that stays
-- unique when two organisers save at the same instant - generating it in
-- application code would race. The year is read in Singapore time so a request
-- saved at 08:00 on 1 January is not stamped with the previous year (AC5).
create sequence event_request_reference_seq;

create table event_request (
  id uuid primary key default gen_random_uuid(),

  reference text not null unique default (
    'EVT-'
    || to_char(timezone('Asia/Singapore', now()), 'YYYY')
    || '-'
    || lpad(nextval('event_request_reference_seq')::text, 4, '0')
  ),

  -- profiles.id is auth.users.id (see 20260910135902_add_roles_to_profiles).
  organiser_id uuid not null references auth.users (id) on delete restrict,

  -- No foreign key yet: client_organisation arrives with its own story.
  client_organisation_id uuid not null,

  -- SCRUM-76: the basic details.
  name text not null,
  purpose text,
  description text,
  proposed_date date,

  -- Placeholders. SCRUM-77 owns time_slots, SCRUM-78 owns expected_attendance.
  time_slots text[],
  expected_attendance integer,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint event_request_name_not_blank check (btrim(name) <> '')
);

-- `or replace` so a later migration that needs the same helper does not collide.
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger event_request_set_updated_at
  before update on event_request
  for each row execute function set_updated_at();

-- Reads and writes go through the service layer using the service-role key,
-- which bypasses RLS. Enabling it with no policies makes anon/authenticated
-- access deny-by-default instead of wide open.
alter table event_request enable row level security;
