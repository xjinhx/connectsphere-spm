-- =============================================================================
-- SCRUM-128 Search venues by date and slot: AC4
-- A slot recorded as unavailable
-- =============================================================================
-- AC4: "Given a venue's Night slot has been recorded as unavailable and I search
--      for the Night slot, when the search runs, then that venue is excluded."
--
-- Recording a slot as unavailable is SCRUM-151's (Withdraw venue availability
-- when circumstances change), which is not merged. "Shared tables belong to no
-- single story" (CLAUDE.md), so this story creates the smallest table SCRUM-151
-- will need anyway, the same way SCRUM-120 created venue_booking for SCRUM-148
-- (D-04):
--
-- D-09 DUMMY(SCRUM-151): venue_unavailable_slot. Nothing writes it yet; testers
--      add rows by hand. SCRUM-151 builds the Venue Staff flow that writes it
--      (its AC1: "those slots are recorded as unavailable") and may add columns,
--      such as who recorded it. SCRUM-123 AC7 reads the same rows to show a slot
--      as Blocked with its reason.
--
-- Term per CONTEXT.md: an *unavailable slot* is one slot at one venue on one
-- date that Venue Staff have withdrawn from use, with the reason recorded
-- (customer clarification #54). Not "blocked slot": the calendar only *labels*
-- it Blocked.
-- =============================================================================

-- DUMMY(SCRUM-151) D-09: nothing writes this yet; testers add rows.
create table if not exists venue_unavailable_slot (
  id uuid primary key default gen_random_uuid(),

  -- Cascade: an unavailable slot is a fact about this venue and goes with it.
  -- Venues are retired rather than deleted, so in practice this never fires.
  venue_id uuid not null references venues (id) on delete cascade,

  date date not null,

  -- The same three slots as venues.operating_slots and event_request.time_slots
  -- (customer clarification #50).
  slot text not null
    constraint venue_unavailable_slot_slot_known check (slot in ('am', 'pm', 'night')),

  -- Clarification #54 and SCRUM-151 AC1: the reason is recorded, and SCRUM-123
  -- AC7 shows it. Required, so a slot can't be withdrawn without saying why.
  reason text not null
    constraint venue_unavailable_slot_reason_present check (length(trim(reason)) > 0),

  created_at timestamptz not null default now(),

  -- A slot is either withdrawn or not: recording it twice would say nothing new.
  constraint venue_unavailable_slot_once unique (venue_id, date, slot)
);

-- AC4 reads every unavailable slot on one date.
create index if not exists venue_unavailable_slot_date_idx on venue_unavailable_slot (date);

-- Deny-all backstop, the same as every other table: server code reads and
-- writes through the service-role client and decides access in policy.ts.
alter table venue_unavailable_slot enable row level security;
