-- =============================================================================
-- SCRUM-151 Withdraw venue availability when circumstances change: AC1
-- =============================================================================
-- AC1: "Given I select a venue, a date and the affected slots and record a
--      reason, when I save, then those slots are recorded as unavailable and
--      are no longer offered for new bookings."
--
-- One row per venue, date and slot (CONTEXT.md: "Unavailable slot"). Venue
-- Staff can tick several slots in one save; each becomes its own row with the
-- same reason. A row per slot rather than one row holding a list, so "is PM on
-- 3 Oct unavailable?" is a one-row lookup for every story that asks it
-- (SCRUM-154, SCRUM-155, SCRUM-128, SCRUM-123), and the unique constraint below
-- can refuse the same slot being marked twice.
--
-- "No longer offered for new bookings" is not enforced here: booking requests
-- and venue search do not exist yet. Those stories ask findUnavailableSlots
-- (src/domain/availability/service.ts), which reads this table.
-- =============================================================================

create table if not exists venue_unavailable_slot (
  id uuid primary key default gen_random_uuid(),

  -- Cascade: the record only means something for its venue.
  venue_id uuid not null references venues (id) on delete cascade,

  slot_date date not null,

  -- The three fixed slots (customer clarification #50), as everywhere else.
  slot text not null
    constraint venue_unavailable_slot_slot_known check (slot in ('am', 'pm', 'night')),

  -- AC1: a reason is recorded. Blank is not a reason.
  reason text not null
    constraint venue_unavailable_slot_reason_present check (length(trim(reason)) > 0),

  -- Who withdrew it. Restrict, the same as decided_by: deleting an account
  -- must not erase who took the slot out of use.
  recorded_by uuid not null references auth.users (id) on delete restrict,
  recorded_at timestamptz not null default now(),

  -- A slot is either unavailable or it is not: marking it twice is refused.
  -- Its index also serves every lookup by venue and date.
  constraint venue_unavailable_slot_once unique (venue_id, slot_date, slot)
);

-- Deny-all backstop, the same as every other table: server code reads and
-- writes through the service-role client and decides access in policy.ts.
alter table venue_unavailable_slot enable row level security;
