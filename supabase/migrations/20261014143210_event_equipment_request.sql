-- =============================================================================
-- SCRUM-160 — Record the equipment an event needs
-- =============================================================================
-- "As an Event Coordinator, I want to record the equipment an event needs with
-- quantities, so that Technical Support Staff know exactly what to arrange."
--
-- AC1: the assigned coordinator of an Approved or Planning event adds an
--      equipment type and a quantity, and the item is saved against the
--      event's equipment request. Who may and which statuses are checked in
--      src/domain/equipment-request/service.ts before the insert, the same as
--      SCRUM-142's booking request; RLS here is the deny-all backstop.
-- AC2: a quantity of zero or below is refused
--      (equipment_request_line_quantity_at_least_one).
-- AC3: the same type twice is two lines, never merged, so there is
--      deliberately no unique index on (event_request_id, equipment_id) -
--      unlike SCRUM-80's event_request_equipment_item_unique.
--
-- Kept apart from SCRUM-80's event_request_equipment (20260913100000): that is
-- the free text an Event Organiser types on the request form, with one line per
-- item. This is the coordinator's request, chosen from the equipment catalogue
-- (SCRUM-240 AC5), and the organiser's answer is left as they gave it.
-- =============================================================================

-- One equipment request per event. Created with the event's first line.
create table equipment_request (
  event_request_id uuid primary key references event_request (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- AC1: one row per item, naming a catalogue item and a quantity.
create table equipment_request_line (
  id uuid primary key default gen_random_uuid(),
  event_request_id uuid not null references equipment_request (event_request_id) on delete cascade,
  -- SCRUM-240 AC5: only an item the catalogue holds. Restrict, so a catalogue
  -- item an event still asks for cannot be deleted out from under it.
  equipment_id uuid not null references equipment (id) on delete restrict,
  -- AC2: zero or negative is refused. The schema refuses it first, with the
  -- message; this is the backstop.
  quantity integer not null
    constraint equipment_request_line_quantity_at_least_one check (quantity >= 1),
  -- Who added it. Restrict, as created_by elsewhere.
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The request is read in the order its lines were added.
create index equipment_request_line_event_idx on equipment_request_line (event_request_id, created_at);

-- Deny-all backstop, the same as every other table: server code reads and
-- writes through the service-role client and decides access in the service.
alter table equipment_request enable row level security;
alter table equipment_request_line enable row level security;
