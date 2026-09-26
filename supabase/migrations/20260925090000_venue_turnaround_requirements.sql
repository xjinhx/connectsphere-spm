-- =============================================================================
-- SCRUM-119 Record setup, teardown and turnaround requirements
-- =============================================================================
-- setup_minutes, teardown_minutes and turnaround_minutes already exist on
-- venues, with their 0-240 check constraints, added early by
-- 20260911063000_create_venue_catalogue.sql for this story to fill in.
-- CreateVenueInputSchema deliberately excludes them (SCRUM-119 is edit-only,
-- per its AC1: "Given I am editing a venue"), so only update_venue needs them.
--
-- AC4 (turnaround greater than the 60-minute slot gap needs confirmation) is
-- NOT checked here, unlike SCRUM-120's capacity-cut check. That one needs the
-- database because it depends on other rows (confirmed bookings) that could
-- change between the service's check and this save - a real race. AC4 only
-- depends on the value being submitted, against a fixed constant, so there is
-- nothing to race: the expectedUpdatedAt/stale check above already serialises
-- two edits to the same venue. The check lives entirely in
-- src/domain/venues/service.ts (turnaroundExceedsSlotGap, policy.ts).
--
-- Dropped and recreated, same reasoning as 20260924170000: a new argument
-- makes a new function in Postgres, and leaving the old one would keep a way
-- to write these fields that skips the app's validation.
-- =============================================================================

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
  p_setup_minutes integer default null,
  p_teardown_minutes integer default null,
  p_turnaround_minutes integer default null
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
    setup_minutes = coalesce(p_setup_minutes, setup_minutes),
    teardown_minutes = coalesce(p_teardown_minutes, teardown_minutes),
    turnaround_minutes = coalesce(p_turnaround_minutes, turnaround_minutes),
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
  uuid, timestamptz, text, uuid, integer, text[], uuid[], uuid[], jsonb, boolean, date, integer, integer, integer
) from public, anon, authenticated;
grant execute on function update_venue(
  uuid, timestamptz, text, uuid, integer, text[], uuid[], uuid[], jsonb, boolean, date, integer, integer, integer
) to service_role;
