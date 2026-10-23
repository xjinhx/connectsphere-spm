-- =============================================================================
-- SCRUM-173 - Reserve equipment for the full commitment window and view all
--             reservations for the event
-- =============================================================================
-- "As a Technical Support Staff member, I want to reserve available equipment
-- for an event for its full commitment window, and see everything reserved for
-- it in one place, so that it is committed to that event, cannot be taken by
-- another, and the coordinator can tell whether the technical arrangements are
-- complete."
--
-- Reserves into equipment_reservation, as SCRUM-167 shaped it
-- (20261022004756_equipment_commitment_window.sql): a quantity of a line's item
-- for the event's commitment window, F-1 to L (AC3), from equipment_window().
-- This replaces dummy D-18: rows were inserted by hand until now.
--
-- reserve_equipment applies SCRUM-167's rule again inside the write, with the
-- item locked: what is available is the item's quantity less the most units
-- other events hold on any one day of the window, and this event can reserve
-- that less what it already holds. So the check and the reservation agree, and
-- two reservations at once cannot both take the last units - the same split as
-- update_venue and SCRUM-120.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Reserving
-- -----------------------------------------------------------------------------
-- Reserves p_quantity more units of a line's item for its event's whole
-- commitment window. One reservation per line (equipment_reservation's unique
-- line_id): reserving again adds to it.
--
-- Returns {"outcome": ...}:
--   no_approved_booking   173 AC2: the event has no confirmed venue booking
--   more_than_outstanding the line asks for fewer units than that; with
--                         "outstanding", what is left to reserve on it
--   not_enough_available  173 AC4: fewer units are left to reserve; with
--                         "available", what is available (167) less what this
--                         event already holds of the item. Offering the part
--                         that is free is SCRUM-175's
--   reserved              173 AC1, AC3, AC5: with "reservationId"; no cap on
--                         the window's length
-- The service checks who may reserve and that the line is the event's.
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
  v_item_quantity integer;
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
  -- first's units as committed.
  select quantity into v_item_quantity from equipment where id = v_line.equipment_id for update;

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

  v_available := greatest(v_item_quantity - v_busiest - v_own, 0);
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

-- Only the server may run it.
revoke all on function reserve_equipment(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function reserve_equipment(uuid, integer, uuid) to service_role;