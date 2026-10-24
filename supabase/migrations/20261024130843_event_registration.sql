-- =============================================================================
-- SCRUM-181 — Register for an event
-- =============================================================================
-- "As an Attendee, I want to register for an event and provide the information
-- required, so that my place is recorded."
--
-- AC1: with the registration period open and places remaining, submitting
--      full name, email address and contact number creates a registration
--      with status Registered, and a confirmation is shown.
-- AC2: before the registration start date, refused, and the start date shown.
-- AC3: after the registration end date, refused, and the end date shown.
-- AC4: both dates are inclusive.
-- AC5: a second registration for the same event is refused, and the existing
--      one shown. Matched by the signed-in account, not the typed email (PO,
--      23/10/2026).
-- AC6: no limit on how many events one attendee joins.
--
-- Shared by SCRUM-182 (refusing a full event), SCRUM-184 (withdrawing) and
-- SCRUM-185 (the registration list, and the coordinator's form that sets the
-- registration period). Agreed with the PO on 23/10/2026: this story creates
-- the table and the columns, and those stories extend them rather than adding
-- their own.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The registration period and capacity, on the event
-- -----------------------------------------------------------------------------
-- Dates, not times: customer clarification #30 names a "start and end date",
-- and AC4 makes both whole days inclusive, in Singapore time.
--
-- Nothing in the app sets these yet: the coordinator's form is SCRUM-185 AC5
-- (dummy D-22). Until then the seed script sets them.
alter table event_request
  add column registration_start_date date,
  add column registration_end_date date,
  -- How many places the event has. Counted against by SCRUM-182 (dummy D-23);
  -- what it is set to is SCRUM-185 AC6's rule. Null until set.
  add column registration_capacity integer;

alter table event_request
  -- Both dates or neither: a period with only one end is not a period.
  add constraint event_request_registration_period_complete
    check ((registration_start_date is null) = (registration_end_date is null)),
  -- A one-day period (start = end) is allowed; AC4 makes it that whole day.
  add constraint event_request_registration_period_in_order
    check (registration_start_date <= registration_end_date),
  add constraint event_request_registration_capacity_at_least_one
    check (registration_capacity >= 1);


-- -----------------------------------------------------------------------------
-- 2. The registration
-- -----------------------------------------------------------------------------
-- The confirmation (AC1) shows the reference. A sequence, as for the event's
-- own reference, so two attendees registering at the same instant cannot be
-- given the same one; the year is read in Singapore time.
create sequence event_registration_reference_seq;

create table event_registration (
  id uuid primary key default gen_random_uuid(),

  reference text not null unique default (
    'REG-'
    || to_char(timezone('Asia/Singapore', now()), 'YYYY')
    || '-'
    || lpad(nextval('event_registration_reference_seq')::text, 4, '0')
  ),

  -- Cascade: a registration means nothing without its event.
  event_request_id uuid not null references event_request (id) on delete cascade,

  -- The signed-in Attendee account (AC5 matches on this). Restrict, as
  -- elsewhere: deleting an account must not erase who registered.
  attendee_id uuid not null references auth.users (id) on delete restrict,

  -- AC1: the three details the form asks for (customer clarification #22),
  -- as typed. The email is a contact field, not the account's sign-in email.
  full_name text not null
    constraint event_registration_full_name_present check (btrim(full_name) <> ''),
  email text not null
    constraint event_registration_email_present check (btrim(email) <> ''),
  contact_number text not null
    constraint event_registration_contact_number_present check (btrim(contact_number) <> ''),

  -- AC1: Registered. Withdrawn is SCRUM-184's; nothing sets it yet.
  status text not null default 'registered'
    constraint event_registration_status_known check (status in ('registered', 'withdrawn')),

  -- The registration date, which SCRUM-185's registration list shows.
  registered_at timestamptz not null default now()
);

-- AC5: one Registered registration per attendee per event. Among Registered
-- rows only, so someone who withdrew (SCRUM-184) can register again. Also what
-- stops a double-click registering twice (TC-181-15): the second insert waits
-- for the first and then fails here.
create unique index event_registration_one_per_attendee
  on event_registration (event_request_id, attendee_id)
  where status = 'registered';

-- AC6: an attendee's registrations across events.
create index event_registration_attendee_idx on event_registration (attendee_id);

-- Deny-all backstop, the same as every other table: server code reads and
-- writes through the service-role client and decides access in the service.
alter table event_registration enable row level security;


-- -----------------------------------------------------------------------------
-- 3. Whether places remain
-- -----------------------------------------------------------------------------
-- DUMMY(SCRUM-182) D-23: always true. Refusing a full event is SCRUM-182 AC1;
-- it replaces this body with a count of the event's Registered rows against
-- registration_capacity. register_for_event calls it with the event row
-- already locked, so two people taking the last place at the same moment
-- (SCRUM-182 AC2) are counted one after the other.
create or replace function event_has_places_remaining(p_event_request_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select true;
$$;


-- -----------------------------------------------------------------------------
-- 4. Registering
-- -----------------------------------------------------------------------------
-- The service checks everything first, so it can say why it refuses. This
-- function checks again with the event row locked, so a registration is never
-- written outside the period or past the last place, whatever changed after
-- the service read the event.
--
-- p_today is the Singapore date the service decided "today" is, passed in so
-- the service and this function agree on it (AC4: the dates are whole
-- Singapore days, TC-181-13).
--
-- Returns 'registered', 'not_found', 'not_open' (no period set),
-- 'not_started' (AC2), 'ended' (AC3), 'full' (SCRUM-182) or
-- 'already_registered' (AC5).
create or replace function register_for_event(
  p_event_request_id uuid,
  p_attendee_id uuid,
  p_full_name text,
  p_email text,
  p_contact_number text,
  p_today date
) returns text
language plpgsql
set search_path = public
as $$
declare
  v_start date;
  v_end date;
begin
  select registration_start_date, registration_end_date into v_start, v_end
  from event_request
  where id = p_event_request_id
  for update;

  if not found then
    return 'not_found';
  end if;

  if v_start is null then
    return 'not_open';
  end if;

  -- AC2, AC3, AC4: both dates inclusive. Kept in step with
  -- registrationPeriodRefusal in src/domain/event-registration/policy.ts.
  if p_today < v_start then
    return 'not_started';
  end if;
  if p_today > v_end then
    return 'ended';
  end if;

  -- AC5.
  if exists (
    select 1 from event_registration
    where event_request_id = p_event_request_id
      and attendee_id = p_attendee_id
      and status = 'registered'
  ) then
    return 'already_registered';
  end if;

  -- AC1: places remain. D-23 until SCRUM-182.
  if not event_has_places_remaining(p_event_request_id) then
    return 'full';
  end if;

  insert into event_registration (event_request_id, attendee_id, full_name, email, contact_number)
  values (p_event_request_id, p_attendee_id, btrim(p_full_name), btrim(p_email), btrim(p_contact_number));

  return 'registered';
exception
  -- The event row lock already orders two registrations for one event, so
  -- this is only a backstop for AC5.
  when unique_violation then
    return 'already_registered';
end;
$$;

revoke all on function register_for_event(uuid, uuid, text, text, text, date)
  from public, anon, authenticated;
grant execute on function register_for_event(uuid, uuid, text, text, text, date)
  to service_role;

revoke all on function event_has_places_remaining(uuid)
  from public, anon, authenticated;
grant execute on function event_has_places_remaining(uuid)
  to service_role;
