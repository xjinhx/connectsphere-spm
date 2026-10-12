-- =============================================================================
-- SCRUM-227 Hold a venue until an expiry
-- =============================================================================
-- AC1: Venue Staff hold a venue for an event, on a date from a start to an end
--      time, until an expiry in the future; the hold is recorded as active.
-- AC2: no expiry, or one in the past, is refused (the service names the field;
--      venue_hold_expires_after_creation is the backstop).
-- AC3, AC4: an active hold commits its period, so other events cannot search
--      for, request or be approved into it. getVenueCommitments reads the
--      holds (src/domain/availability/service.ts); the search, request,
--      approval and calendar checks that call it are SCRUM-239's.
-- AC5: when the holding event's own request for that period is approved, a
--      confirmed booking is created and the hold is closed. The trigger below
--      closes it, in the same transaction as the booking, whichever code
--      writes the booking.
-- AC6: once the expiry passes, the hold commits nothing and is never counted
--      as a booking. Nothing has to run at the expiry: every read compares
--      expires_at with the time of the read. An expired hold stays 'active' in
--      this table; "lapsed" is active and past its expiry (SCRUM-228).
-- AC7: the calendar shows an active hold as Held with its expiry, from the
--      same read.
--
-- Times follow the shared time model (20261008140500_time_model.sql): clock
-- times on the 15-minute unit, half-open, within one date.
--
-- Customer #41: one active hold or booking per overlapping period. The
-- service refuses a hold over a period that is already committed (PO-agreed
-- reading, Slack 10 Oct 2026).
-- =============================================================================

create table if not exists venue_hold (
  id uuid primary key default gen_random_uuid(),

  -- Restrict: a venue with holds is retired, not deleted (as venue_booking).
  venue_id uuid not null references venues (id) on delete restrict,

  -- Cascade: a hold belongs to its event and goes with it.
  event_request_id uuid not null references event_request (id) on delete cascade,

  date date not null,
  start_time time not null,
  end_time time not null,

  -- AC1, AC2: when the hold stops committing the venue.
  expires_at timestamptz not null,

  -- 'active' until the event's booking for the period is confirmed (AC5),
  -- then 'closed'. Expiry is not a status: see AC6 above.
  status text not null default 'active'
    constraint venue_hold_status_known check (status in ('active', 'closed')),
  closed_at timestamptz,

  -- The Venue Staff member who placed it. Restrict, as decided_by elsewhere:
  -- deleting an account must not erase who did what.
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),

  constraint venue_hold_times_quarter_hours check (is_quarter_hour(start_time) and is_quarter_hour(end_time)),
  constraint venue_hold_ends_after_start check (end_time > start_time),
  constraint venue_hold_expires_after_creation check (expires_at > created_at),
  constraint venue_hold_closed_when_closed check ((status = 'closed') = (closed_at is not null))
);

-- getVenueCommitments reads a venue's active holds by date.
create index if not exists venue_hold_venue_date_idx on venue_hold (venue_id, date) where status = 'active';
create index if not exists venue_hold_event_idx on venue_hold (event_request_id);

-- Deny-all backstop, the same as every other table: server code reads and
-- writes through the service-role client and decides access in policy.ts.
alter table venue_hold enable row level security;


-- -----------------------------------------------------------------------------
-- AC5: a confirmed booking for the held event closes its hold
--
-- After insert on venue_booking, so the booking's start and end times are
-- already filled in (venue_booking_fill_times runs before insert). Only a hold
-- that has not expired is closed: one that lapsed first stays lapsed, so
-- SCRUM-228 can tell "became a booking" from "lapsed".
-- -----------------------------------------------------------------------------
create or replace function close_holds_on_booking() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'confirmed' then
    update venue_hold h set
      status = 'closed',
      closed_at = now()
    where h.status = 'active'
      and h.expires_at > now()
      and h.event_request_id = new.event_request_id
      and h.venue_id = new.venue_id
      and h.date = new.date
      and h.start_time < new.end_time
      and new.start_time < h.end_time;
  end if;
  return null;
end;
$$;

create trigger venue_booking_closes_holds after insert on venue_booking
  for each row execute function close_holds_on_booking();
