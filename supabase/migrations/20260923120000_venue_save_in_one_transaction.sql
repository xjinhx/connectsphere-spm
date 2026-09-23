-- =============================================================================
-- SCRUM-116 Add a venue to the catalogue
-- SCRUM-120 Update venue information
-- Save a venue and its lists in one transaction
-- =============================================================================
-- Found reviewing SCRUM-215, and the same family of bug:
--
-- 1. supabase-js has no transactions, so a save was several statements: the
--    venue row, then a delete and an insert for each list. A failure part-way
--    left the venue half-saved (a list wiped, a rename kept) while the editor
--    was told nothing had been saved. A create undid itself with a
--    compensating delete whose own failure went unnoticed.
-- 2. An edit made from a form that had gone out of date silently undid every
--    change saved since it was opened. Two edits at once could also both pass
--    SCRUM-118's "no layout above the maximum capacity" check against the old
--    values and together leave a layout above the maximum.
--
-- These functions make each save one transaction, so all of it happens or none
-- of it does. update_venue also takes the updated_at the editor's form was
-- loaded with, locks the venue, and only saves while the venue still has that
-- value. Every save moves updated_at on, so whoever saves second from the same
-- version is told the venue has changed, and the checks the service ran before
-- calling still hold when the save lands: nothing can have changed in between.
--
-- The rules stay in src/domain/venues (schema.ts and policy.ts); these only
-- write. They are called from src/lib/supabase/venues.ts with the service-role
-- client, and nobody else may execute them.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- SCRUM-116 AC1 to AC4, SCRUM-117 AC1 and AC2, SCRUM-118 AC1
-- Returns the new venue's id. A duplicate name raises 23505 from the unique
-- index, as the plain insert did, and nothing is left behind.
-- -----------------------------------------------------------------------------
create or replace function create_venue(
  p_name text,
  p_location_id uuid,
  p_max_capacity integer,
  p_operating_slots text[],
  p_facility_ids uuid[],
  p_accessibility_feature_ids uuid[],
  p_layouts jsonb
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_venue_id uuid;
begin
  insert into venues (name, location_id, max_capacity, operating_slots)
  values (p_name, p_location_id, p_max_capacity, p_operating_slots)
  returning id into v_venue_id;

  insert into venue_facilities (venue_id, facility_id)
  select v_venue_id, facility_id from unnest(p_facility_ids) as facility_id;

  insert into venue_accessibility_features (venue_id, accessibility_feature_id)
  select v_venue_id, feature_id from unnest(p_accessibility_feature_ids) as feature_id;

  insert into venue_layouts (venue_id, layout, capacity)
  select v_venue_id, layout, capacity
  from jsonb_to_recordset(p_layouts) as layouts (layout text, capacity integer);

  return v_venue_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- SCRUM-120 AC1, SCRUM-117 AC3, SCRUM-118
-- A null argument means "not sent, leave it alone", the same as the PATCH
-- body. A list that is sent replaces the whole list, so an empty one removes
-- them all (SCRUM-117 AC3).
--
-- Returns 'updated', 'stale' (the venue changed since p_expected_updated_at)
-- or 'not_found'. Neither of the last two has written anything.
-- -----------------------------------------------------------------------------
create or replace function update_venue(
  p_venue_id uuid,
  p_expected_updated_at timestamptz,
  p_name text default null,
  p_location_id uuid default null,
  p_max_capacity integer default null,
  p_operating_slots text[] default null,
  p_facility_ids uuid[] default null,
  p_accessibility_feature_ids uuid[] default null,
  p_layouts jsonb default null
) returns text
language plpgsql
set search_path = public
as $$
declare
  v_updated_at timestamptz;
begin
  -- The lock makes a second save of this venue wait here until this one
  -- commits, and then see the updated_at this one wrote.
  select updated_at into v_updated_at
  from venues
  where id = p_venue_id
  for update;

  if not found then
    return 'not_found';
  end if;
  if v_updated_at is distinct from p_expected_updated_at then
    return 'stale';
  end if;

  -- greatest(): updated_at is the version, so it must move forward on every
  -- save even if two land within the same microsecond or the clock steps back.
  update venues set
    name = coalesce(p_name, name),
    location_id = coalesce(p_location_id, location_id),
    max_capacity = coalesce(p_max_capacity, max_capacity),
    operating_slots = coalesce(p_operating_slots, operating_slots),
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


-- -----------------------------------------------------------------------------
-- Only the server may run these. Supabase grants EXECUTE on new functions to
-- anon and authenticated by default, which would let anyone holding the public
-- anon key call them directly. The tables' deny-all RLS would still stop the
-- writes, but the functions should not be reachable at all.
-- -----------------------------------------------------------------------------
revoke all on function create_venue(text, uuid, integer, text[], uuid[], uuid[], jsonb)
  from public, anon, authenticated;
grant execute on function create_venue(text, uuid, integer, text[], uuid[], uuid[], jsonb)
  to service_role;

revoke all on function update_venue(uuid, timestamptz, text, uuid, integer, text[], uuid[], uuid[], jsonb)
  from public, anon, authenticated;
grant execute on function update_venue(uuid, timestamptz, text, uuid, integer, text[], uuid[], uuid[], jsonb)
  to service_role;
