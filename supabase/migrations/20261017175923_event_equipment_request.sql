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
-- AC5: the technical requirements are stored with the request
--      (equipment_request.technical_requirements).
-- AC7, AC8: whether a line has been reserved decides whether reducing it needs
--      a confirmation. Reserving equipment is SCRUM-167 (stretch, not built),
--      so equipment_reservation below is a stand-in: dummy D-18.
-- AC10: the first equipment request raised against an Approved event moves it
--      to Planning (equipment_request_line_enter_planning, below).
-- AC11: an event already in Planning stays Planning when a further request is
--      raised: the same trigger matches only 'approved', so it changes nothing.
--
-- Kept apart from SCRUM-80's event_request_equipment (20260913100000): that is
-- the free text an Event Organiser types on the request form, with one line per
-- item. This is the coordinator's request, chosen from the equipment catalogue
-- (SCRUM-240 AC5), and the organiser's answer is left as they gave it.
-- =============================================================================

-- One equipment request per event. Created with the event's first line, or
-- the first time its technical requirements are saved.
create table equipment_request (
  event_request_id uuid primary key references event_request (id) on delete cascade,
  -- AC5: free-text technical requirements, stored as typed (line breaks and
  -- all). Null when none have been entered. 1000 characters, the same limit
  -- as SCRUM-80's technical_support_notes.
  technical_requirements text
    constraint equipment_request_technical_requirements_length
      check (technical_requirements is null or length(technical_requirements) between 1 and 1000),
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

-- -----------------------------------------------------------------------------
-- AC10: Approved -> Planning when the first equipment request is raised
-- -----------------------------------------------------------------------------
-- SCRUM-101's rule, not a second copy of it: the same function its trigger on
-- venue_booking_request runs (20261006100000), which moves the event named by
-- new.event_request_id from 'approved' to 'planning' and leaves any other
-- status alone. Its name says booking request because that story added it for
-- one; the body only reads event_request_id, which a line has too.
--
-- Raising the request means adding an item, so this fires on a new line.
-- Saving the technical requirements alone does not move the event (interim,
-- to confirm at standup - recorded on TC-160-26). It runs in the same
-- transaction as the insert, so the line and the event's new status land
-- together or not at all, and a refused item (AC2, AC4) never moves it.
create trigger equipment_request_line_enter_planning
  after insert on equipment_request_line
  for each row execute function enter_planning_on_booking_request();

-- -----------------------------------------------------------------------------
-- AC8: reservations - a stand-in until SCRUM-167
-- -----------------------------------------------------------------------------
-- DUMMY(SCRUM-167) D-18: no story in this sprint reserves equipment, so a line
-- is reserved when a row here names it, and rows are inserted by hand. The
-- warning AC8 asks for runs against it for real. SCRUM-167 replaces this with
-- its own reservation record (see docs/dummies.md, D-18).
create table equipment_reservation (
  id uuid primary key default gen_random_uuid(),
  -- One reservation per line. Cascade: a reserved line is only removed after
  -- the coordinator confirms (AC8), and its reservation goes with it.
  line_id uuid not null unique references equipment_request_line (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table equipment_reservation enable row level security;
