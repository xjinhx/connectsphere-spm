-- =============================================================================
-- SCRUM-151 Withdraw venue availability when circumstances change: AC2
-- =============================================================================
-- AC2: "Given an affected slot carries a confirmed booking for an upcoming
--      event, when I save the change, then the booking is flagged as affected
--      and the assigned Event Coordinator is notified with the reason."
--
-- Three pieces:
--
-- affected_booking_slot (view) is the flag. A confirmed booking is affected on
--   every slot of its event's date that is recorded as unavailable at its
--   venue (CONTEXT.md: "Affected booking"). It is worked out, never stored, so
--   it cannot go stale, and it clears itself once the booking stops being
--   confirmed, which is what SCRUM-151 AC3's "until they release or replace
--   it" needs.
--
-- venue_unavailability_notice (table) is what the coordinator is told.
--
-- mark_slots_unavailable (function) is the save. It writes the slots and the
--   notices in one transaction, so a coordinator is never told about a slot
--   that was not saved, and a saved slot is never left untold. AC1's single
--   insert moves in here for that reason, the same approach update_venue
--   takes for SCRUM-120's capacity notices.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- The flag: which confirmed bookings sit on an unavailable slot
--
-- DUMMY(SCRUM-148) D-04: bookings come from the stand-in venue_booking. A
-- booking there has no date or slot of its own; both come from its event
-- request, as in SCRUM-120. When SCRUM-148 gives a booking its own date and
-- slot, this view reads those instead.
--
-- One row per affected slot, so a booking whose AM and PM are both withdrawn
-- appears twice. Callers decide what "upcoming" means (a Singapore date).
-- security_invoker: the view is read with the caller's rights, so the tables'
-- deny-all row level security still applies to anyone but the server.
-- -----------------------------------------------------------------------------
create or replace view affected_booking_slot
with (security_invoker = true) as
select
  b.id as booking_id,
  b.event_request_id,
  b.venue_id,
  e.proposed_date as slot_date,
  u.slot,
  u.reason,
  e.coordinator_id
from venue_booking b
join event_request e on e.id = b.event_request_id
join venue_unavailable_slot u
  on u.venue_id = b.venue_id
 and u.slot_date = e.proposed_date
 and u.slot = any (e.time_slots)
where b.status = 'confirmed';


-- -----------------------------------------------------------------------------
-- What the coordinator is told
--
-- DUMMY(SCRUM-193) D-09: stored, not shown, until the in-app notification list
-- exists. The same stand-in as SCRUM-120's venue_capacity_notice (D-05).
-- -----------------------------------------------------------------------------
create table if not exists venue_unavailability_notice (
  id uuid primary key default gen_random_uuid(),

  -- Cascade: the notice is about this venue and this event.
  venue_id uuid not null references venues (id) on delete cascade,
  event_request_id uuid not null references event_request (id) on delete cascade,

  -- Who is told: the event's assigned coordinator. Not null, unlike
  -- venue_capacity_notice: AC2 notifies "the assigned Event Coordinator", so
  -- with nobody assigned there is nobody to tell. The booking still shows as
  -- affected on the event (the view above), so whoever is assigned later sees
  -- it. Restrict, as in SCRUM-94: deleting an account must not erase who was
  -- told what.
  coordinator_id uuid not null references auth.users (id) on delete restrict,

  -- What they are told: which of the event's slots on that date were
  -- withdrawn, and why.
  slot_date date not null,
  slots text[] not null
    constraint venue_unavailability_notice_slots_known check (
      cardinality(slots) between 1 and 3 and slots <@ array['am', 'pm', 'night']::text[]
    ),
  reason text not null,

  created_at timestamptz not null default now()
);

create index if not exists venue_unavailability_notice_coordinator_idx
  on venue_unavailability_notice (coordinator_id, created_at);

alter table venue_unavailability_notice enable row level security;


-- -----------------------------------------------------------------------------
-- The save: slots and notices in one transaction
--
-- p_today is the Singapore date the service decided "upcoming" against
-- (todayInSingapore in src/domain/shared/dates.ts). Without it the Singapore
-- date is worked out here. Never current_date: the database runs in UTC,
-- which is still on yesterday until 08:00 in Singapore.
--
-- Returns the number of notices written: one per affected booking of an
-- upcoming event that has a coordinator.
-- -----------------------------------------------------------------------------
create or replace function mark_slots_unavailable(
  p_venue_id uuid,
  p_slot_date date,
  p_slots text[],
  p_reason text,
  p_recorded_by uuid,
  p_today date default null
) returns integer
language plpgsql
set search_path = public
as $$
declare
  v_today date := coalesce(p_today, timezone('Asia/Singapore', now())::date);
  v_notices integer;
begin
  -- AC1: one row per slot. A slot that is already unavailable breaks the
  -- unique constraint, which aborts the whole function, so nothing is saved.
  insert into venue_unavailable_slot (venue_id, slot_date, slot, reason, recorded_by)
  select p_venue_id, p_slot_date, s, p_reason, p_recorded_by
  from unnest(p_slots) as s;

  -- AC2: one notice per affected booking of an upcoming event, naming the
  -- event's slots that were just withdrawn, in AM, PM, Night order.
  insert into venue_unavailability_notice (venue_id, event_request_id, coordinator_id, slot_date, slots, reason)
  select
    a.venue_id,
    a.event_request_id,
    a.coordinator_id,
    a.slot_date,
    array_agg(a.slot order by array_position(array['am', 'pm', 'night']::text[], a.slot)),
    p_reason
  from affected_booking_slot a
  where a.venue_id = p_venue_id
    and a.slot_date = p_slot_date
    and a.slot = any (p_slots)
    and a.slot_date >= v_today
    and a.coordinator_id is not null
  group by a.venue_id, a.event_request_id, a.coordinator_id, a.slot_date;

  get diagnostics v_notices = row_count;
  return v_notices;
end;
$$;

-- Only the server may run it, like update_venue.
revoke all on function mark_slots_unavailable(uuid, date, text[], text, uuid, date)
  from public, anon, authenticated;
grant execute on function mark_slots_unavailable(uuid, date, text[], text, uuid, date)
  to service_role;
