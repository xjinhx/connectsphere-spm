-- =============================================================================
-- SCRUM-80 — State equipment and technical support requirements
-- =============================================================================
-- Same shape as SCRUM-79's accessibility answer: an explicit yes/none first,
-- then the detail. Nothing here is mandatory to save or submit.
--
-- There is no equipment catalogue in this sprint (Equipment Request /
-- Availability are Release 1, later sprints), so an item is free text. The
-- story that adds a catalogue should replace `item` with a reference to it.

-- AC3: the answer itself.
--   NULL  - not yet answered
--   false - no equipment needed ("the answer recorded as none")
--   true  - needed; the items below say what
-- AC2: the technical support description is deliberately NOT tied to that
-- answer - the card says it is saved "whether or not any equipment item has
-- been added".
alter table event_request
  add column equipment_required boolean,
  add column technical_support_notes text
    check (technical_support_notes is null or btrim(technical_support_notes) <> '');

-- AC1: one row per item, with its quantity. `position` keeps the order the
-- organiser listed them in and doubles as the key.
create table event_request_equipment (
  event_request_id uuid not null references event_request (id) on delete cascade,
  position smallint not null check (position >= 0),
  item text not null check (length(btrim(item)) between 1 and 100),
  quantity integer not null check (quantity > 0),
  primary key (event_request_id, position)
);

-- The same item listed twice on one request is a mistake, not two needs.
create unique index event_request_equipment_item_unique
  on event_request_equipment (event_request_id, lower(btrim(item)));

alter table event_request_equipment enable row level security;
