-- =============================================================================
-- SCRUM-76 — Create an event request with basic details
-- =============================================================================
-- Shared table. US-5.1 bundles SCRUM-76 + 77 + 78, so the columns here mirror
-- `eventRequestCoreSchema` in src/domain/event-request/schema.ts rather than
-- only SCRUM-76's own fields - one table, created once, matching the contract
-- the three tickets already agreed. Flagged on the PR for 77/78 to review.
--
-- `status` is the exception worth arguing about: the shared schema marks
-- draft/submitted as SCRUM-84's, but SCRUM-76 AC3 ("saving it as a draft
-- remains allowed") cannot be satisfied without it. Kept minimal here -
-- two values, no transitions beyond DRAFT -> SUBMITTED - so SCRUM-84 can take
-- it over without unpicking anything.

create type event_request_status as enum ('DRAFT', 'SUBMITTED');

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

  name text not null,
  purpose text,
  description text,
  proposed_date date,
  time_slots text[],
  expected_attendance integer,

  status event_request_status not null default 'DRAFT',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint event_request_name_not_blank check (btrim(name) <> ''),

  constraint event_request_attendance_positive check (
    expected_attendance is null or expected_attendance > 0
  ),

  -- coalesce, because array_length('{}') is NULL, not 0 - without it an empty
  -- array slips through as "unknown" and satisfies the check.
  constraint event_request_slots_valid check (
    time_slots is null
    or (
      coalesce(array_length(time_slots, 1), 0) between 1 and 3
      and time_slots <@ array['AM', 'PM', 'NIGHT']::text[]
    )
  ),

  -- The draft/submit split, enforced where it cannot be bypassed: a draft may
  -- be incomplete (AC3), a submitted request may not (AC2).
  constraint event_request_submitted_is_complete check (
    status = 'DRAFT'
    or (
      btrim(coalesce(purpose, '')) <> ''
      and btrim(coalesce(description, '')) <> ''
      and proposed_date is not null
      and coalesce(array_length(time_slots, 1), 0) >= 1
      and expected_attendance is not null
    )
  )
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
