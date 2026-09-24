-- =============================================================================
-- SCRUM-120 Update venue information: AC2, AC3 and AC4
-- A capacity cut that affects a confirmed future booking
-- =============================================================================
-- AC2: a cut below a confirmed future booking's expected attendance shows that
--      booking and must be confirmed before it is applied.
-- AC3: a cut down to exactly the expected attendance applies with no warning.
-- AC4: a confirmed cut notifies the coordinator assigned to each affected event.
--
-- Two things these need are not in Sprint 1, so each gets the minimum stand-in
-- (docs/dummies.md):
--
-- D-04 DUMMY(SCRUM-148): venue_booking. Bookings are SCRUM-148's. "Shared
--      tables belong to no single story" (CLAUDE.md), so this story creates the
--      smallest table SCRUM-148 will need anyway: which event is booked into
--      which venue, and that the booking is confirmed. Nothing in Sprint 1
--      writes to it; testers add rows by hand. SCRUM-148 builds the request and
--      approval flow that writes it, and may widen `status`.
-- D-05 DUMMY(SCRUM-24): venue_capacity_notice. There is no notification system
--      in Sprint 1. As with SCRUM-94 (D-03) and SCRUM-96 (D-06), the minimum
--      honest notification is a record of exactly what the coordinator would be
--      told, stored in the same transaction as the change. SCRUM-24 sends it.
--
-- update_venue gains the check, so the booking check, the cut and the notices
-- happen in the transaction and under the venue lock that
-- 20260923120000_venue_save_in_one_transaction.sql already takes.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- D-04: a confirmed booking of an event into a venue
-- DUMMY(SCRUM-148) D-04: nothing writes this in Sprint 1; testers add rows.
-- -----------------------------------------------------------------------------
create table if not exists venue_booking (
  id uuid primary key default gen_random_uuid(),

  -- Restrict: a venue with bookings is retired, not deleted.
  venue_id uuid not null references venues (id) on delete restrict,

  -- Cascade: a booking belongs to its event and goes with it. The event's
  -- date, expected attendance and coordinator are read from event_request, so
  -- they are never copied here and cannot drift.
  event_request_id uuid not null references event_request (id) on delete cascade,

  -- Only 'confirmed' exists until SCRUM-148 adds the rest of the lifecycle.
  status text not null default 'confirmed'
    constraint venue_booking_status_known check (status in ('confirmed')),

  created_at timestamptz not null default now(),

  constraint venue_booking_once_per_venue unique (venue_id, event_request_id)
);

-- AC2 reads a venue's confirmed bookings.
create index if not exists venue_booking_venue_idx on venue_booking (venue_id, status);

-- Deny-all backstop, the same as every other table: server code reads and
-- writes through the service-role client and decides access in policy.ts.
alter table venue_booking enable row level security;


-- -----------------------------------------------------------------------------
-- D-05: what the coordinator of an affected event is told
-- DUMMY(SCRUM-24) D-05: stored, not sent, until the Notification System exists.
-- -----------------------------------------------------------------------------
create table if not exists venue_capacity_notice (
  id uuid primary key default gen_random_uuid(),

  -- Cascade: the notice is about this venue and this event.
  venue_id uuid not null references venues (id) on delete cascade,
  event_request_id uuid not null references event_request (id) on delete cascade,

  -- Who is being told. Null when the event has no coordinator yet: the cut
  -- still affected it, there was just nobody assigned to tell. Restrict, the
  -- same as SCRUM-94: deleting an account must not erase who was told what.
  coordinator_id uuid references auth.users (id) on delete restrict,

  -- What they are told: the venue went from this to this, below the event's
  -- expected attendance.
  previous_capacity integer not null,
  new_capacity integer not null,
  expected_attendance integer not null,

  created_at timestamptz not null default now(),

  constraint venue_capacity_notice_is_a_cut check (new_capacity < previous_capacity),
  constraint venue_capacity_notice_affects_event check (expected_attendance > new_capacity)
);

create index if not exists venue_capacity_notice_coordinator_idx
  on venue_capacity_notice (coordinator_id, created_at);

alter table venue_capacity_notice enable row level security;


-- -----------------------------------------------------------------------------
-- update_venue, with SCRUM-120 AC2 to AC4
--
-- Same as before, plus p_confirm_affected_bookings, p_today and one more
-- outcome: 'affected_bookings', returned when the cut affects a confirmed
-- future booking and was not confirmed. Like 'stale' and 'not_found', it has
-- written nothing.
--
-- p_today is the Singapore date the service decided "future" against
-- (todayInSingapore in src/domain/shared/dates.ts), so the list the editor is
-- shown and this check use the same day even across midnight. Without it the
-- Singapore date is worked out here. Never current_date: the database runs in
-- UTC, which is still on yesterday until 08:00 in Singapore, so an event that
-- has already happened would count as a future booking.
--
-- Dropped and recreated rather than replaced: a new argument makes a new
-- function in Postgres, and leaving the old one would keep a way to cut the
-- capacity that skips the check.
-- -----------------------------------------------------------------------------
drop function if exists update_venue(uuid, timestamptz, text, uuid, integer, text[], uuid[], uuid[], jsonb);

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
  p_today date default null
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
  -- The lock makes a second save of this venue wait here until this one
  -- commits, and then see the updated_at this one wrote.
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

  -- SCRUM-120 AC2 and AC3. The same rule as isCapacityCut and
  -- isAffectedByCapacity in src/domain/venues/policy.ts: only a cut can affect
  -- a booking, and only one whose expected attendance is above the new maximum
  -- (100 against 99 is affected, 100 against 100 is not). It is repeated here
  -- so the check and the write see the same bookings: the service checks
  -- first to show the editor the list, but a booking could be confirmed in
  -- between. The affected events are read once, so the decision and the
  -- notices below are about exactly the same bookings.
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

    -- SCRUM-120 AC4. DUMMY(SCRUM-24) D-05: one notice per affected event,
    -- addressed to its coordinator, written with the cut so neither can happen
    -- without the other.
    insert into venue_capacity_notice (
      venue_id,
      event_request_id,
      coordinator_id,
      previous_capacity,
      new_capacity,
      expected_attendance
    )
    select p_venue_id, e.id, e.coordinator_id, v_max_capacity, p_max_capacity, e.expected_attendance
    from event_request e
    where e.id = any (v_affected);
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

-- Only the server may run it, as before.
revoke all on function update_venue(uuid, timestamptz, text, uuid, integer, text[], uuid[], uuid[], jsonb, boolean, date)
  from public, anon, authenticated;
grant execute on function update_venue(uuid, timestamptz, text, uuid, integer, text[], uuid[], uuid[], jsonb, boolean, date)
  to service_role;
