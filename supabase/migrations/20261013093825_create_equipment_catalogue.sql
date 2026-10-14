-- =============================================================================
-- SCRUM-240 — Maintain the equipment catalogue
-- =============================================================================
-- "As a Technical Support Staff member, I want to record the equipment
-- ConnectSphere owns with its quantity and operational status, so that
-- coordinators' requests can be checked against real stock."
--
-- AC1: an item is saved and listed with a name, category, quantity and current
--      location. Every one of those four is required (equipment_* checks
--      below); the service names the missing field, these are the backstop.
-- AC2: operational status is one of Available, Unavailable, Damaged or Under
--      maintenance (equipment_status_known).
-- AC3: only Technical Support Staff may add or change an item. Enforced in
--      code (equipment_administration, SCRUM-69's matrix), as every other
--      table's access is - RLS here is the deny-all backstop.
-- AC4: a quantity below zero or not a whole number is refused
--      (equipment_quantity_not_negative, plus the integer column type).
-- AC5: a coordinator's equipment requirement can only name an item that
--      exists here. The requirement itself is SCRUM-160's; this story owns the
--      catalogue it is chosen from.
--
-- Customer clarifications: #13 the modelling is ours to propose, but the
-- system must know the quantity available; #2 equipment has a physical
-- location; #9 Technical Support Staff are responsible for equipment status;
-- #23 equipment can be recorded as unavailable, damaged or under maintenance.
--
-- Deliberately NOT here:
-- - SCRUM-80's free-text equipment on an event request
--   (event_request_equipment, 20260913100000). That migration says a catalogue
--   story "should replace `item` with a reference to it"; SCRUM-240 does not,
--   because the organiser's request form keeps its own field (TC-240-17) and
--   moving it is SCRUM-160's question, not this story's.
-- - how much of an item is free on a date. AC5 limits the choice to items that
--   exist, not to items free on the date (TC-240-16); availability and
--   reservation are SCRUM-166/167/170, not in this sprint.
-- - a unique item name. "ConnectSphere owns 4 projectors" is the quantity
--   column, so no AC asks for one; add it as its own story if the team wants
--   duplicates refused.
-- =============================================================================

create table if not exists equipment (
  id uuid primary key default gen_random_uuid(),

  -- AC1: the four fields an item is recorded with. 100 characters, the same
  -- limit as a venue name and SCRUM-80's equipment item.
  name text not null
    constraint equipment_name_present check (length(btrim(name)) between 1 and 100),

  -- A fixed list, like venues.operating_slots: a proposal under #13 for the
  -- team to extend, not a list the customer gave. Kept in step with
  -- EQUIPMENT_CATEGORIES in src/domain/equipment/schema.ts.
  category text not null
    constraint equipment_category_known check (category in ('av', 'furniture', 'computing', 'other')),

  -- AC4, #13: the quantity ConnectSphere owns. Zero is allowed (an item the
  -- catalogue records but holds none of); below zero is not. `integer` is what
  -- refuses 2.5 and "ten" at the database; the schema refuses them first.
  quantity integer not null
    constraint equipment_quantity_not_negative check (quantity >= 0),

  -- #2: where the item physically is. Free text, not locations (id): a store
  -- room is not one of the venue locations a venue is chosen from, and the
  -- customer named no list to choose from.
  current_location text not null
    constraint equipment_location_present check (length(btrim(current_location)) between 1 and 100),

  -- AC2, #23. A new item starts Available: AC1 lists no status field, so the
  -- add form cannot set one (interim rule, to confirm at standup - recorded on
  -- the ticket and in TC-240-03).
  operational_status text not null default 'available'
    constraint equipment_status_known
      check (operational_status in ('available', 'unavailable', 'damaged', 'under_maintenance')),

  -- Who recorded it. Restrict, as created_by elsewhere: deleting an account
  -- must not erase who did what.
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The catalogue list is read in name order (AC1 "listed in the catalogue").
create index if not exists equipment_name_idx on equipment (lower(btrim(name)));

-- Deny-all backstop, the same as every other table: server code reads and
-- writes through the service-role client and decides access in policy.ts
-- (AC3).
alter table equipment enable row level security;


-- -----------------------------------------------------------------------------
-- updated_at, so the catalogue can show when a status was last changed (AC2)
-- -----------------------------------------------------------------------------
create or replace function touch_equipment_updated_at() returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger equipment_touch_updated_at before update on equipment
  for each row execute function touch_equipment_updated_at();
