-- =============================================================================
-- SCRUM-100 — Record which arrangements are essential for an event
-- =============================================================================
-- "As an Event Coordinator, I want to mark which arrangements are essential
-- for this particular event, so that the system knows what must be complete
-- before the event can be confirmed."
--
-- AC1: the assigned coordinator of an Approved or Planning event marks each of
--      venue, equipment, technical support and registration as essential or
--      not required, and that set is stored against the event.
-- AC2: an event with no arrangement marked essential is shown as having no
--      outstanding essential arrangements. No row and a row of four falses
--      read the same (the service treats a missing row as all not required).
-- AC3: on a Confirmed event the set cannot be changed until the event is
--      returned to Planning.
--
-- Its own table rather than columns on event_request, so this story adds no
-- second migration to a table the time model migration (20261008140500)
-- changed (agreed on day 1).
-- =============================================================================

create table if not exists event_essential_arrangements (
  -- One set per event. Cascade: the set means nothing without its event.
  event_request_id uuid primary key references event_request (id) on delete cascade,

  -- AC1: the four arrangements, each essential (true) or not required (false).
  venue boolean not null,
  equipment boolean not null,
  technical_support boolean not null,
  registration boolean not null,

  -- Who recorded the set and when. Restrict, as elsewhere: deleting an account
  -- must not erase who did what.
  recorded_by uuid not null references auth.users (id) on delete restrict,
  recorded_at timestamptz not null default now()
);

-- Deny-all backstop, the same as every other table: server code reads and
-- writes through the service-role client and decides access in policy.ts.
alter table event_essential_arrangements enable row level security;


-- -----------------------------------------------------------------------------
-- Recording the set
--
-- The service checks the coordinator and the status first, so it can say why
-- it refuses. This function checks them again with the event row locked, so a
-- set can never be saved on an event that was Confirmed after the service read
-- it (AC3, TC-100-10): moving the event to Confirmed updates the same row, so
-- it waits for this, or this waits for it and then sees Confirmed.
--
-- Returns 'recorded', 'not_found', 'not_assigned', or the event's status when
-- that status does not allow a change.
-- -----------------------------------------------------------------------------

create or replace function record_essential_arrangements(
  p_event_request_id uuid,
  p_recorded_by uuid,
  p_venue boolean,
  p_equipment boolean,
  p_technical_support boolean,
  p_registration boolean
) returns text
language plpgsql
set search_path = public
as $$
declare
  v_status text;
  v_coordinator_id uuid;
begin
  select status, coordinator_id into v_status, v_coordinator_id
  from event_request
  where id = p_event_request_id
  for update;

  if not found then
    return 'not_found';
  end if;

  -- AC1: the assigned coordinator only.
  if v_coordinator_id is distinct from p_recorded_by then
    return 'not_assigned';
  end if;

  -- AC1: Approved or Planning. AC3: Confirmed, and every other status, refused.
  -- Kept in step with canChangeEssentialArrangements in
  -- src/domain/essential-arrangements/policy.ts.
  if v_status not in ('approved', 'planning') then
    return v_status;
  end if;

  -- AC1: the new set replaces the old one (TC-100-02).
  insert into event_essential_arrangements
    (event_request_id, venue, equipment, technical_support, registration, recorded_by, recorded_at)
  values
    (p_event_request_id, p_venue, p_equipment, p_technical_support, p_registration, p_recorded_by, now())
  on conflict (event_request_id) do update set
    venue = excluded.venue,
    equipment = excluded.equipment,
    technical_support = excluded.technical_support,
    registration = excluded.registration,
    recorded_by = excluded.recorded_by,
    recorded_at = excluded.recorded_at;

  return 'recorded';
end;
$$;

revoke all on function record_essential_arrangements(uuid, uuid, boolean, boolean, boolean, boolean)
  from public, anon, authenticated;
grant execute on function record_essential_arrangements(uuid, uuid, boolean, boolean, boolean, boolean)
  to service_role;
