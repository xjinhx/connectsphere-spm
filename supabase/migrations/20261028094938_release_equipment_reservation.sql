-- =============================================================================
-- SCRUM-177 Release a reservation
-- =============================================================================
-- AC1: "when I release it and give a reason, then its status becomes Released
--      and the quantity returns to availability for the released window."
-- AC5: "the released reservation is shown with its release reason and date."
--
-- A released reservation keeps its row, as a released booking does (SCRUM-231,
-- 20261012100000_venue_booking_release.sql), so the event still shows what was
-- given up and why. Only its status changes, and everything that counts units
-- as committed already reads Reserved ones only: SCRUM-167's check,
-- reserve_equipment and SCRUM-102's equipment check. So its units are free
-- again for its window, and none of them change.
--
-- One reservation per line (SCRUM-173): a released line reserved again is
-- Reserved, and the earlier release is not kept (reserve_equipment, below).
--
-- This replaces dummy D-21: reservations were released by hand until now.
-- =============================================================================

alter table equipment_reservation
  -- AC1, AC5: why it was released, by whom and when. Restrict, the same as
  -- reserved_by: deleting an account must not erase who released what.
  add column release_reason text,
  add column released_by uuid references auth.users (id) on delete restrict,
  add column released_at timestamptz,

  -- A released reservation always says why, who and when; a reserved one never
  -- does. "release_reason is not null" is needed: length(trim(null)) is null,
  -- and a check that comes out null passes.
  add constraint equipment_reservation_release_recorded check (
    (status = 'reserved' and release_reason is null and released_by is null and released_at is null)
    or (status = 'released' and release_reason is not null and length(trim(release_reason)) > 0
        and released_by is not null and released_at is not null)
  );

-- -----------------------------------------------------------------------------
-- Releasing
-- -----------------------------------------------------------------------------
-- AC1: releases a reservation that is still Reserved. Returns false, changing
-- nothing, when it is not (already released: a second click, another tab).
-- The service checks who may release, that the reservation is the event's and
-- that a reason is given.
create function release_equipment_reservation(
  p_reservation_id uuid,
  p_reason text,
  p_released_by uuid
) returns boolean
language sql
set search_path = public
as $$
  with released as (
    update equipment_reservation
       set status = 'released',
           release_reason = p_reason,
           released_by = p_released_by,
           released_at = now(),
           updated_at = now()
     where id = p_reservation_id
       and status = 'reserved'
    returning id
  )
  select exists (select 1 from released);
$$;

-- Only the server may run it.
revoke all on function release_equipment_reservation(uuid, text, uuid) from public, anon, authenticated;
grant execute on function release_equipment_reservation(uuid, text, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- reserve_equipment (SCRUM-173): reserving a released line again clears its
-- release, so it is Reserved with no old reason (one reservation per line).
-- Otherwise as 20261024084449_equipment_out_of_service.sql left it.
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
        -- SCRUM-177: the earlier release is not kept.
        release_reason = null,
        released_by = null,
        released_at = null,
        updated_at = now()
  returning id into v_id;

  return jsonb_build_object('outcome', 'reserved', 'reservationId', v_id);
end;
$$;

revoke all on function reserve_equipment(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function reserve_equipment(uuid, integer, uuid) to service_role;
