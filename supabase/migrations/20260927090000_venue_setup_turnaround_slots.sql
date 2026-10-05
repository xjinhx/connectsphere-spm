-- =============================================================================
-- SCRUM-119 (revised 2026-09-27): Record whether a venue needs setup and
-- turnaround slots
-- =============================================================================
-- Supersedes this story's first version, which recorded setup/teardown/
-- turnaround as minutes (0-240) with a confirmation flow for a turnaround
-- above the 60-minute slot gap. The product owner rewrote the story: teardown
-- is folded into turnaround, and both are now yes/no flags rather than
-- durations. SCRUM-148 applies the actual slot-blocking rule using these
-- flags; this story only records them, so there is no threshold or
-- confirmation logic here at all.
--
-- setup_minutes, teardown_minutes and turnaround_minutes are dropped: nothing
-- on main ever wrote to them (the only branch that did was this story's own,
-- unmerged), so there is no data to migrate.
-- =============================================================================

alter table venues
  drop column if exists setup_minutes,
  drop column if exists teardown_minutes,
  drop column if exists turnaround_minutes,
  add column needs_setup_slot boolean not null default false,
  add column needs_turnaround_slot boolean not null default false;

-- update_venue gains the two new parameters. Dropped and recreated, same
-- reasoning as every other change to this function: a new argument makes a
-- new function in Postgres, and leaving the old one would keep a way to
-- write a venue that skips the app's validation.
drop function if exists update_venue(
  uuid, timestamptz, text, uuid, integer, text[], uuid[], uuid[], jsonb, boolean, date
);

create or replace function update_venue(
  p_venue_id uuid,
  p_expected_updated_at timestamptz,
  p_name text default null,
  p_location_id uuid default null,
  p_max_capacity integer default null,
  p_operating_slots text[] default null,
  p_facility_ids uuid[] default null,
  p_accessibility_feature_ids uuid[] default null,
  p_layouts jsonb default null,
  p_confirm_affected_bookings boolean default false,
  p_today date default null,
  p_needs_setup_slot boolean default null,
  p_needs_turnaround_slot boolean default null
) returns text
language plpgsql
set search_path = public
as $$
declare
  v_updated_at timestamptz;
  v_max_capacity integer;
  v_affected uuid[];
  v_today date := coalesce(p_today, timezone('Asia/Singapore', now())::date);
begin
  select updated_at, max_capacity into v_updated_at, v_max_capacity
  from venues
  where id = p_venue_id
  for update;

  if not found then
    return 'not_found';
  end if;
  if v_updated_at is distinct from p_expected_updated_at then
    return 'stale';
  end if;

  if p_max_capacity is not null and p_max_capacity < v_max_capacity then
    select coalesce(array_agg(e.id), '{}') into v_affected
    from venue_booking b
    join event_request e on e.id = b.event_request_id
    where b.venue_id = p_venue_id
      and b.status = 'confirmed'
      and e.proposed_date >= v_today
      and e.expected_attendance > p_max_capacity;

    if cardinality(v_affected) > 0 and not coalesce(p_confirm_affected_bookings, false) then
      return 'affected_bookings';
    end if;

    insert into venue_capacity_notice (
      venue_id, event_request_id, coordinator_id,
      previous_capacity, new_capacity, expected_attendance
    )
    select p_venue_id, e.id, e.coordinator_id, v_max_capacity, p_max_capacity, e.expected_attendance
    from event_request e
    where e.id = any (v_affected);
  end if;

  update venues set
    name = coalesce(p_name, name),
    location_id = coalesce(p_location_id, location_id),
    max_capacity = coalesce(p_max_capacity, max_capacity),
    operating_slots = coalesce(p_operating_slots, operating_slots),
    needs_setup_slot = coalesce(p_needs_setup_slot, needs_setup_slot),
    needs_turnaround_slot = coalesce(p_needs_turnaround_slot, needs_turnaround_slot),
    updated_at = greatest(clock_timestamp(), v_updated_at + interval '1 microsecond')
  where id = p_venue_id;

  if p_facility_ids is not null then
    delete from venue_facilities where venue_id = p_venue_id;
    insert into venue_facilities (venue_id, facility_id)
    select p_venue_id, facility_id from unnest(p_facility_ids) as facility_id;
  end if;

  if p_accessibility_feature_ids is not null then
    delete from venue_accessibility_features where venue_id = p_venue_id;
    insert into venue_accessibility_features (venue_id, accessibility_feature_id)
    select p_venue_id, feature_id from unnest(p_accessibility_feature_ids) as feature_id;
  end if;

  if p_layouts is not null then
    delete from venue_layouts where venue_id = p_venue_id;
    insert into venue_layouts (venue_id, layout, capacity)
    select p_venue_id, layout, capacity
    from jsonb_to_recordset(p_layouts) as layouts (layout text, capacity integer);
  end if;

  return 'updated';
end;
$$;

revoke all on function update_venue(
  uuid, timestamptz, text, uuid, integer, text[], uuid[], uuid[], jsonb, boolean, date, boolean, boolean
) from public, anon, authenticated;
grant execute on function update_venue(
  uuid, timestamptz, text, uuid, integer, text[], uuid[], uuid[], jsonb, boolean, date, boolean, boolean
) to service_role;
