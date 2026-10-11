-- =============================================================================
-- SCRUM-225 Record setup and turnaround time for each venue
-- =============================================================================
-- AC1: Venue Staff enter a setup and a turnaround time in whole minutes, in
--      15-minute steps, and both are stored against the venue.
-- AC2: a negative value, or one that is not a multiple of 15, is refused.
-- AC3: a venue with no times recorded shows 0 and 0.
-- AC4: a change that makes two confirmed bookings clash lists them, and must
--      be confirmed before it is applied.
-- AC5: once confirmed, the change is applied, both bookings stay confirmed and
--      each is flagged as affected. Nothing is removed.
--
-- The columns themselves came with the shared time-model migration
-- (20261008140500_time_model.sql, PR #89): setup_minutes and
-- turnaround_minutes on venues, default 0 (AC3), with check constraints that
-- refuse a negative or non-15-minute value (AC2's backstop; the service names
-- the field first). This migration adds what is left:
--
-- 1. clock_minutes(), so a time can be widened by minutes and compared.
-- 2. setup_turnaround_affected_booking, the AC5 flag.
-- 3. update_venue saving the two values, with the AC4 check inside the save.
--
-- Committed time (CLAUDE.md, "committed, not occupied"): a booking commits the
-- venue from its start minus the venue's setup to its end plus its turnaround.
-- SCRUM-226 applies the same rule to search, requests, approvals and the
-- calendar; this story only uses it to find the bookings a change would make
-- clash. committedMinutes in src/domain/venues/policy.ts is the same rule in
-- TypeScript; keep the two in step.
--
-- Replaces SCRUM-119's yes/no flags (needs_setup_slot, needs_turnaround_slot)
-- in the app. The columns and update_venue's parameters for them are kept, as
-- the slot columns are kept by the time-model migration, until nothing reads
-- them; SCRUM-119 stays Done (Week 7 guide, scenario 2).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Minutes after midnight. 24:00 is 1440, so a booking ending at 24:00 plus
--    a turnaround compares correctly.
-- -----------------------------------------------------------------------------
create or replace function clock_minutes(p_time time) returns integer
language sql immutable set search_path = public as $$
  select (extract(epoch from p_time) / 60)::integer
$$;


-- -----------------------------------------------------------------------------
-- 2. AC5: a confirmed booking flagged as affected by a setup or turnaround
--    change. One row per booking per change, so the history of which change
--    flagged it is kept. The booking itself is not touched: it stays
--    confirmed (AC5: "neither is removed").
-- -----------------------------------------------------------------------------
create table if not exists setup_turnaround_affected_booking (
  id uuid primary key default gen_random_uuid(),

  -- Cascade: the flag is about this booking and goes with it.
  booking_id uuid not null references venue_booking (id) on delete cascade,
  venue_id uuid not null references venues (id) on delete cascade,

  -- The values the confirmed change set, so the flag says what caused it.
  setup_minutes integer not null,
  turnaround_minutes integer not null,

  flagged_at timestamptz not null default now()
);

create index if not exists setup_turnaround_affected_booking_venue_idx
  on setup_turnaround_affected_booking (venue_id, flagged_at);

-- Deny-all backstop, the same as every other table: server code reads and
-- writes through the service-role client and decides access in policy.ts.
alter table setup_turnaround_affected_booking enable row level security;


-- -----------------------------------------------------------------------------
-- 3. update_venue, with SCRUM-225
--
-- As last written by SCRUM-148 (20261007090000), plus:
--   p_setup_minutes, p_turnaround_minutes  AC1: the new values (null = unchanged)
--   p_confirm_setup_turnaround_change      AC4: the editor has seen the list
-- and one more outcome, 'setup_turnaround_clashes', returned when the change
-- makes confirmed future bookings clash and was not confirmed. Like 'stale',
-- 'not_found' and 'affected_bookings', it writes nothing.
--
-- Every check now runs before anything is written. Before, a confirmed
-- capacity cut wrote its notices first; with a second check after it, an
-- unconfirmed setup change would have returned with those notices already
-- written.
--
-- Which bookings clash (AC4): two confirmed bookings at this venue on the same
-- date from today on, of different events, whose committed times overlap with
-- the new values but did not with the current ones. So:
--   - only the change is judged, not clashes that were already there;
--   - an event's own bookings never clash with each other: one event using the
--     room 10:00-12:00 and 13:00-15:00 does not need it reset in between;
--   - touching periods do not clash (half-open, as rangesOverlap in
--     src/domain/shared/times.ts), so 10:00-12:00 with a 60-minute turnaround
--     leaves a 13:00 booking alone.
--
-- Dropped and recreated rather than replaced: a new argument makes a new
-- function in Postgres, and leaving the old one would keep a way to save a
-- venue that skips the check.
-- -----------------------------------------------------------------------------
drop function if exists update_venue(
  uuid, timestamptz, text, uuid, integer, text[], uuid[], uuid[], jsonb, boolean, date, boolean, boolean
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
  p_needs_turnaround_slot boolean default null,
  p_setup_minutes integer default null,
  p_turnaround_minutes integer default null,
  p_confirm_setup_turnaround_change boolean default false
) returns text
language plpgsql
set search_path = public
as $$
declare
  v_updated_at timestamptz;
  v_max_capacity integer;
  v_setup integer;
  v_turnaround integer;
  v_new_setup integer;
  v_new_turnaround integer;
  v_affected uuid[] := '{}';
  v_clashing uuid[] := '{}';
  v_today date := coalesce(p_today, timezone('Asia/Singapore', now())::date);
begin
  select updated_at, max_capacity, setup_minutes, turnaround_minutes
    into v_updated_at, v_max_capacity, v_setup, v_turnaround
  from venues
  where id = p_venue_id
  for update;

  if not found then
    return 'not_found';
  end if;
  if v_updated_at is distinct from p_expected_updated_at then
    return 'stale';
  end if;

  -- SCRUM-120 AC2 and AC3: a capacity cut below a confirmed future booking's
  -- expected attendance (the booking's own date, SCRUM-148).
  if p_max_capacity is not null and p_max_capacity < v_max_capacity then
    select coalesce(array_agg(distinct e.id), '{}') into v_affected
    from venue_booking b
    join event_request e on e.id = b.event_request_id
    where b.venue_id = p_venue_id
      and b.status = 'confirmed'
      and b.date >= v_today
      and e.expected_attendance > p_max_capacity;

    if cardinality(v_affected) > 0 and not coalesce(p_confirm_affected_bookings, false) then
      return 'affected_bookings';
    end if;
  end if;

  -- SCRUM-225 AC4: bookings the new setup and turnaround make clash.
  v_new_setup := coalesce(p_setup_minutes, v_setup);
  v_new_turnaround := coalesce(p_turnaround_minutes, v_turnaround);

  if v_new_setup <> v_setup or v_new_turnaround <> v_turnaround then
    select coalesce(array_agg(distinct a.id), '{}') into v_clashing
    from venue_booking a
    join venue_booking b
      on b.venue_id = a.venue_id
     and b.date = a.date
     and b.id <> a.id
     and b.event_request_id <> a.event_request_id
     and b.status = 'confirmed'
    where a.venue_id = p_venue_id
      and a.status = 'confirmed'
      and a.date >= v_today
      -- they clash with the new values...
      and clock_minutes(a.start_time) - v_new_setup < clock_minutes(b.end_time) + v_new_turnaround
      and clock_minutes(b.start_time) - v_new_setup < clock_minutes(a.end_time) + v_new_turnaround
      -- ...and did not with the current ones.
      and not (
        clock_minutes(a.start_time) - v_setup < clock_minutes(b.end_time) + v_turnaround
        and clock_minutes(b.start_time) - v_setup < clock_minutes(a.end_time) + v_turnaround
      );

    if cardinality(v_clashing) > 0 and not coalesce(p_confirm_setup_turnaround_change, false) then
      return 'setup_turnaround_clashes';
    end if;
  end if;

  -- Every check has passed or been confirmed; from here on, write.

  -- SCRUM-120 AC4 (D-05): a notice for each event a confirmed cut affects.
  insert into venue_capacity_notice (
    venue_id, event_request_id, coordinator_id,
    previous_capacity, new_capacity, expected_attendance
  )
  select p_venue_id, e.id, e.coordinator_id, v_max_capacity, p_max_capacity, e.expected_attendance
  from event_request e
  where e.id = any (v_affected);

  -- SCRUM-225 AC5: each clashing booking stays confirmed and is flagged.
  insert into setup_turnaround_affected_booking (booking_id, venue_id, setup_minutes, turnaround_minutes)
  select booking_id, p_venue_id, v_new_setup, v_new_turnaround
  from unnest(v_clashing) as booking_id;

  update venues set
    name = coalesce(p_name, name),
    location_id = coalesce(p_location_id, location_id),
    max_capacity = coalesce(p_max_capacity, max_capacity),
    operating_slots = coalesce(p_operating_slots, operating_slots),
    needs_setup_slot = coalesce(p_needs_setup_slot, needs_setup_slot),
    needs_turnaround_slot = coalesce(p_needs_turnaround_slot, needs_turnaround_slot),
    setup_minutes = v_new_setup,
    turnaround_minutes = v_new_turnaround,
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
  uuid, timestamptz, text, uuid, integer, text[], uuid[], uuid[], jsonb, boolean, date, boolean, boolean,
  integer, integer, boolean
) from public, anon, authenticated;
grant execute on function update_venue(
  uuid, timestamptz, text, uuid, integer, text[], uuid[], uuid[], jsonb, boolean, date, boolean, boolean,
  integer, integer, boolean
) to service_role;
