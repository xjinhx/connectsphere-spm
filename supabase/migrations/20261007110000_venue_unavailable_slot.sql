-- =============================================================================
-- SCRUM-151 Withdraw venue availability when circumstances change: AC1
-- =============================================================================
-- AC1: "Given I select a venue, a date and the affected slots and record a
--      reason, when I save, then those slots are recorded as unavailable and
--      are no longer offered for new bookings."
--
-- Built on SCRUM-128's venue_unavailable_slot (its stand-in for this story,
-- dummy D-09, migration 20261001090000_venue_unavailable_slot.sql), as agreed
-- with its author: one table of unavailable slots, not two (CONTEXT.md:
-- "Unavailable slot"). SCRUM-151 is what writes it.
--
-- The create below is that table, column for column, so this migration works
-- whichever story reaches main first. With SCRUM-128's migration already
-- applied it does nothing; without it, it makes exactly the table SCRUM-128
-- expects. Either way, the one thing SCRUM-151 adds is recorded_by.
--
-- One row per venue, date and slot. Venue Staff can tick several slots in one
-- save; each becomes its own row with the same reason. A row per slot rather
-- than one row holding a list, so "is PM on 3 Oct unavailable?" is a one-row
-- lookup for every story that asks it (SCRUM-154, SCRUM-155, SCRUM-128,
-- SCRUM-123), and the unique constraint can refuse a slot marked twice.
-- =============================================================================

create table if not exists venue_unavailable_slot (
  id uuid primary key default gen_random_uuid(),

  -- Cascade: an unavailable slot is a fact about this venue and goes with it.
  venue_id uuid not null references venues (id) on delete cascade,

  date date not null,

  -- The three fixed slots (customer clarification #50), as everywhere else.
  slot text not null
    constraint venue_unavailable_slot_slot_known check (slot in ('am', 'pm', 'night')),

  -- AC1 and customer clarification #54: a reason is recorded. Blank is not one.
  reason text not null
    constraint venue_unavailable_slot_reason_present check (length(trim(reason)) > 0),

  created_at timestamptz not null default now(),

  -- A slot is either unavailable or it is not: marking it twice is refused.
  constraint venue_unavailable_slot_once unique (venue_id, date, slot)
);

create index if not exists venue_unavailable_slot_date_idx on venue_unavailable_slot (date);

-- Deny-all backstop, the same as every other table: server code reads and
-- writes through the service-role client and decides access in policy.ts.
alter table venue_unavailable_slot enable row level security;

-- SCRUM-151: who withdrew the slot. Restrict, the same as decided_by: deleting
-- an account must not erase who took the slot out of use.
--
-- Nullable on purpose. Rows a tester added by hand under SCRUM-128's stand-in,
-- and the rows SCRUM-128's own tests add, have no recorder, and must keep
-- working. Every slot withdrawn through SCRUM-151's form records one.
alter table venue_unavailable_slot
  add column if not exists recorded_by uuid references auth.users (id) on delete restrict;
