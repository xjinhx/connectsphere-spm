-- =============================================================================
-- SCRUM-230 Give each venue booking its own attendance and requirements
-- =============================================================================
-- AC4: "Given a venue has a confirmed booking for a 40-person breakout session
--      of a 500-person event, when Venue Staff cut the venue's capacity to 45,
--      then that booking is not listed as affected."
-- AC5: "Given the same booking, when the capacity is cut to 39, then the
--      booking is listed and the cut must be confirmed."
--
-- SCRUM-120's capacity check compared the event's attendance with the new
-- maximum. A booking now goes by its request's own attendance, and by the
-- event's when the request left it empty (20261014114328, venueRequirementsOf
-- in venue-booking/policy.ts). A booking with no request line (written before
-- requests had lines, or by hand) has only the event's.
--
-- An event is still listed and notified once. Its notice carries the largest
-- attendance among its bookings over the new maximum (agreed 14 Oct 2026).
--
-- Copied from SCRUM-239's 20261013110000_venue_opening_hours.sql (Part 4,
-- PR #101), as agreed with Yee Teng 14 Oct 2026. Only the capacity check and
-- the capacity notice change. Same arguments, so it is replaced in place and
-- keeps its grants.
-- =============================================================================

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
  p_confirm_setup_turnaround_change boolean default false,
  p_opens_at time default null,
  p_closes_at time default null
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
  -- expected attendance (the booking's own date, SCRUM-148). SCRUM-230 AC4,
  -- AC5: the booking's own attendance, else its event's.
  if p_max_capacity is not null and p_max_capacity < v_max_capacity then
    select coalesce(array_agg(distinct e.id), '{}') into v_affected
    from venue_booking b
    join event_request e on e.id = b.event_request_id
    left join venue_booking_request_line l on l.id = b.request_line_id
    left join venue_booking_request r on r.id = l.request_id
    where b.venue_id = p_venue_id
      and b.status = 'confirmed'
      and b.date >= v_today
      and coalesce(r.expected_attendance, e.expected_attendance) > p_max_capacity;

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
  -- SCRUM-230: with the largest attendance among its bookings over the cut.
  insert into venue_capacity_notice (
    venue_id, event_request_id, coordinator_id,
    previous_capacity, new_capacity, expected_attendance
  )
  select p_venue_id, e.id, e.coordinator_id, v_max_capacity, p_max_capacity,
    max(coalesce(r.expected_attendance, e.expected_attendance))
  from venue_booking b
  join event_request e on e.id = b.event_request_id
  left join venue_booking_request_line l on l.id = b.request_line_id
  left join venue_booking_request r on r.id = l.request_id
  where e.id = any (v_affected)
    and b.venue_id = p_venue_id
    and b.status = 'confirmed'
    and b.date >= v_today
    and coalesce(r.expected_attendance, e.expected_attendance) > p_max_capacity
  group by e.id, e.coordinator_id;

  -- SCRUM-225 AC5: each clashing booking stays confirmed and is flagged.
  insert into setup_turnaround_affected_booking (booking_id, venue_id, setup_minutes, turnaround_minutes)
  select booking_id, p_venue_id, v_new_setup, v_new_turnaround
  from unnest(v_clashing) as booking_id;

  -- SCRUM-239 AC1: the hours, when sent. venues_closes_after_opens and
  -- venues_hours_quarter_hours still guard them; the service checks first, so
  -- the form can name the field.
  update venues set
    name = coalesce(p_name, name),
    location_id = coalesce(p_location_id, location_id),
    max_capacity = coalesce(p_max_capacity, max_capacity),
    operating_slots = coalesce(p_operating_slots, operating_slots),
    needs_setup_slot = coalesce(p_needs_setup_slot, needs_setup_slot),
    needs_turnaround_slot = coalesce(p_needs_turnaround_slot, needs_turnaround_slot),
    setup_minutes = v_new_setup,
    turnaround_minutes = v_new_turnaround,
    opens_at = coalesce(p_opens_at, opens_at),
    closes_at = coalesce(p_closes_at, closes_at),
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
