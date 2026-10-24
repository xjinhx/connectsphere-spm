-- =============================================================================
-- SCRUM-170 - Exclude equipment that is unavailable, damaged or under maintenance
-- =============================================================================
-- "As a Technical Support Staff member, I want equipment recorded as
-- unavailable, damaged or under maintenance excluded from availability, so
-- that unusable equipment is never promised to an event."
--
-- Notes on the card (refinement item 7, CL-46): each item keeps its total
-- quantity (SCRUM-240); Technical Support record how many of those units are
-- out of service and with which status - Unavailable, Damaged or Under
-- maintenance. So: a count per status on the item.
--
-- AC1: the count is saved against the item with its status, and those units
--      are excluded from the available quantity for every window.
-- AC2: returning a unit to service lowers its count, so it is available again.
-- AC3: no end date: an out-of-service unit is excluded from every window
--      until its count is lowered (no expected-return-date column).
-- AC4: more units than the item has, or fewer than zero, is refused
--      (equipment_out_of_service_*); the service names the field first.
-- AC5: an item whose own status (SCRUM-240's operational_status) is not
--      Available has no units available.
-- AC6: availability never goes below zero, and reservations are not touched.
--
-- SCRUM-167's check applies AC1, AC5 and AC6 in
-- src/domain/equipment-out-of-service/policy.ts; reserve_equipment applies them
-- again inside the write, below, so the check and the reservation agree.
-- =============================================================================

alter table equipment
  add column units_unavailable integer not null default 0,
  add column units_damaged integer not null default 0,
  add column units_under_maintenance integer not null default 0,
  add constraint equipment_out_of_service_not_negative
    check (units_unavailable >= 0 and units_damaged >= 0 and units_under_maintenance >= 0),
  add constraint equipment_out_of_service_within_quantity
    check (units_unavailable + units_damaged + units_under_maintenance <= quantity);

-- -----------------------------------------------------------------------------
-- reserve_equipment (SCRUM-173), with out-of-service units and the item's own
-- status taken off what is available. Otherwise as
-- 20261022011508_reserve_equipment.sql left it.
-- -----------------------------------------------------------------------------
create or replace function reserve_equipment(
  p_line_id uuid,
  p_quantity integer,
  p_reserved_by uuid
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_line equipment_request_line%rowtype;
  v_in_service integer;
  v_window_start date;
  v_window_end date;
  v_reserved integer;
  v_busiest integer;
  v_own integer;
  v_available integer;
  v_id uuid;
begin
  select * into v_line from equipment_request_line where id = p_line_id;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  -- Lock the item, so two reservations of it take turns: the second sees the
  -- first's units as committed. SCRUM-170 AC1, AC5: only units in service
  -- count, and none at all while the item itself is not Available.
  select case when operational_status = 'available'
              then quantity - units_unavailable - units_damaged - units_under_maintenance
              else 0 end
    into v_in_service
    from equipment where id = v_line.equipment_id for update;

  select w.window_start, w.window_end into v_window_start, v_window_end
  from equipment_window(v_line.event_request_id) w;
  if v_window_start is null then
    return jsonb_build_object('outcome', 'no_approved_booking');
  end if;

  select coalesce(sum(quantity), 0) into v_reserved
  from equipment_reservation
  where line_id = p_line_id and status = 'reserved';
  if p_quantity > v_line.quantity - v_reserved then
    return jsonb_build_object('outcome', 'more_than_outstanding', 'outstanding', greatest(v_line.quantity - v_reserved, 0));
  end if;

  -- 167 AC5, AC9: the most units other events hold on any one day of the
  -- window.
  select coalesce(max(held), 0) into v_busiest
  from (
    select sum(r.quantity) as held
    from generate_series(v_window_start, v_window_end, interval '1 day') as d (day)
    join equipment_reservation r
      on r.equipment_id = v_line.equipment_id
     and r.status = 'reserved'
     and r.event_request_id <> v_line.event_request_id
     and r.window_start <= d.day::date
     and d.day::date <= r.window_end
    group by d.day
  ) as days;

  -- What this event already holds of the item, on any of its lines: available
  -- to it (167 AC4), but already taken.
  select coalesce(sum(quantity), 0) into v_own
  from equipment_reservation
  where equipment_id = v_line.equipment_id
    and event_request_id = v_line.event_request_id
    and status = 'reserved';

  -- SCRUM-170 AC6: never below zero.
  v_available := greatest(v_in_service - v_busiest - v_own, 0);
  if p_quantity > v_available then
    return jsonb_build_object('outcome', 'not_enough_available', 'available', v_available);
  end if;

  insert into equipment_reservation (line_id, quantity, window_start, window_end, reserved_by)
  values (p_line_id, p_quantity, v_window_start, v_window_end, p_reserved_by)
  on conflict (line_id) do update
    set quantity = case when equipment_reservation.status = 'reserved'
                        then equipment_reservation.quantity + excluded.quantity
                        else excluded.quantity end,
        window_start = excluded.window_start,
        window_end = excluded.window_end,
        status = 'reserved',
        reserved_by = excluded.reserved_by,
        updated_at = now()
  returning id into v_id;

  return jsonb_build_object('outcome', 'reserved', 'reservationId', v_id);
end;
$$;

revoke all on function reserve_equipment(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function reserve_equipment(uuid, integer, uuid) to service_role;
