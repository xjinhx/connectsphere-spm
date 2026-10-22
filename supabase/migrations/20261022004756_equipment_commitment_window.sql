-- =============================================================================
-- SCRUM-167 - Check equipment availability across the full commitment window
-- =============================================================================
-- "As a Technical Support Staff member, I want availability checked across the
-- whole window an item is tied up for, not just the event slot, so that I do
-- not promise equipment that is still out with another event."
--
-- The commitment window (Definitions, CL-29): equipment is collected the day
-- before the event's first booked day and comes back on its last, so an event
-- commits a unit from F-1 to L inclusive, F and L being the first and last
-- dates of its confirmed venue bookings. The unit is free again from L+1.
-- Whole days: a morning and an afternoon event on the same date share the
-- window (AC6).
--
-- Definitions (CL-46): what is available for a window is the item's quantity,
-- less units out of service (SCRUM-170, not built yet), less the most units
-- committed to other events on any single day of the window (AC9: the busiest
-- day, not the sum). The event's own reservations are not counted against it
-- (AC4). Those rules are pure functions in
-- src/domain/equipment-reservation/policy.ts.
--
-- What is committed is read from equipment_reservation. SCRUM-160 created it as
-- a stand-in (dummy D-18), one row per reserved line. A shared table belongs to
-- no single story, so this story gives it what the check needs - a quantity,
-- the window it holds and a status - and keeps it, so SCRUM-160's reserved-line
-- check and its AC8 warning keep working. Reserving through the app is
-- SCRUM-173's; until then rows are still inserted by hand (D-18, now waiting on
-- SCRUM-173).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. An event's commitment window
-- -----------------------------------------------------------------------------
-- AC1: F-1 to L. Both null when the event has no confirmed venue booking (AC3).
-- A released booking (SCRUM-231) no longer counts.
--
-- The same rule is commitmentWindow() in
-- src/domain/equipment-reservation/policy.ts, which the availability check
-- uses; this copy is for the database (the fill trigger below, and
-- SCRUM-173's reserve_equipment). Change both together.
create or replace function equipment_window(p_event_request_id uuid)
returns table (window_start date, window_end date)
language sql
stable
set search_path = public
as $$
  select min(b.date) - 1, max(b.date)
  from venue_booking b
  where b.event_request_id = p_event_request_id
    and b.status = 'confirmed';
$$;

-- -----------------------------------------------------------------------------
-- 2. The reservation record
-- -----------------------------------------------------------------------------
-- Rows inserted by hand under D-18 named only a line. Fill them in where the
-- event has a confirmed booking, and drop the rest: they were test rows on
-- events that could never have reserved anything.
--
-- Before pushing this to the cloud database, check what would be dropped:
--   select r.* from equipment_reservation r
--   join equipment_request_line l on l.id = r.line_id
--   where not exists (select 1 from venue_booking b
--                     where b.event_request_id = l.event_request_id and b.status = 'confirmed');
alter table equipment_reservation
  add column event_request_id uuid references event_request (id) on delete cascade,
  add column equipment_id uuid references equipment (id) on delete restrict,
  add column quantity integer,
  add column window_start date,
  add column window_end date,
  -- Reserved or Released (SCRUM-173 AC6). Only a Reserved one commits units.
  -- Releasing is SCRUM-177's; nothing sets 'released' yet.
  add column status text not null default 'reserved'
    constraint equipment_reservation_status_known check (status in ('reserved', 'released')),
  -- Who reserved it: null for a row inserted by hand (D-18); SCRUM-173 records
  -- it. Restrict, as created_by elsewhere.
  add column reserved_by uuid references auth.users (id) on delete restrict,
  add column updated_at timestamptz not null default now();

update equipment_reservation r
set event_request_id = l.event_request_id,
    equipment_id = l.equipment_id,
    quantity = l.quantity,
    window_start = w.window_start,
    window_end = w.window_end
from equipment_request_line l
cross join lateral equipment_window(l.event_request_id) w
where l.id = r.line_id;

delete from equipment_reservation where window_start is null;

alter table equipment_reservation
  alter column event_request_id set not null,
  alter column equipment_id set not null,
  alter column quantity set not null,
  alter column window_start set not null,
  alter column window_end set not null,
  add constraint equipment_reservation_quantity_at_least_one check (quantity >= 1),
  add constraint equipment_reservation_window_in_order check (window_start <= window_end);

-- AC5: an item's reservations that are still held, by the days they cover.
create index equipment_reservation_item_window_idx
  on equipment_reservation (equipment_id, window_start, window_end)
  where status = 'reserved';

-- AC4: an event's own reservations.
create index equipment_reservation_event_idx on equipment_reservation (event_request_id);

-- A reservation always matches its line's event and item, and a row that
-- names only its line (a seed script, as under D-18) reserves the whole line
-- for the event's window. That is how rows are added by hand until SCRUM-173.
create or replace function fill_equipment_reservation() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_line equipment_request_line%rowtype;
begin
  select * into v_line from equipment_request_line where id = new.line_id;
  if not found then
    return new; -- the foreign key refuses it
  end if;
  new.event_request_id := v_line.event_request_id;
  new.equipment_id := v_line.equipment_id;
  new.quantity := coalesce(new.quantity, v_line.quantity);
  if new.window_start is null or new.window_end is null then
    select w.window_start, w.window_end into new.window_start, new.window_end
    from equipment_window(v_line.event_request_id) w;
  end if;
  return new;
end;
$$;

create trigger equipment_reservation_fill
  before insert on equipment_reservation
  for each row execute function fill_equipment_reservation();

-- SCRUM-160 AC8: a reserved line reduced after the coordinator confirms the
-- warning applies the change to its reservation, so a reservation never holds
-- more than its line asks for.
create or replace function cap_equipment_reservation() returns trigger
language plpgsql
set search_path = public
as $$
begin
  update equipment_reservation
  set quantity = new.quantity, updated_at = now()
  where line_id = new.id and quantity > new.quantity;
  return new;
end;
$$;

create trigger equipment_request_line_cap_reservation
  after update of quantity on equipment_request_line
  for each row execute function cap_equipment_reservation();

-- Only the server may run it.
revoke all on function equipment_window(uuid) from public, anon, authenticated;
grant execute on function equipment_window(uuid) to service_role;