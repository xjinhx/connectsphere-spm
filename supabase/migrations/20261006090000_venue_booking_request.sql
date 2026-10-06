-- =============================================================================
-- SCRUM-142 — Submit a venue booking request for an event
-- =============================================================================
-- AC1: an Event Coordinator submits a request naming one venue, a date and
--      the required slots. The request is created with status Pending and
--      appears in the Venue Staff queue.
-- AC2: refused unless the event is Approved — see the note on
--      can_create_booking_request (src/domain/venue-booking/policy.ts) about
--      SCRUM-101's Planning status, which is not on main yet.
-- AC3: the same request can carry several dates for the same venue; each
--      date/slot line is decided independently of its siblings.
-- AC4: refused if the actor is not the event's assigned coordinator (enforced
--      in the service layer, not here — same pattern as every other
--      assigned-coordinator check in this codebase).
--
-- Two new tables, not a widened venue_booking, deliberately: venue_booking
-- (SCRUM-120's D-04 stand-in,
-- 20260924170000_venue_capacity_cut_affected_bookings.sql) already
-- represents a CONFIRMED booking with no date/slot of its own — it reads
-- both from its event request — and the capacity-cut logic already merged
-- to main (fetchConfirmedFutureBookings, findAffectedFutureBookings) depends
-- on that exact shape. Retrofitting it to also represent an undecided,
-- possibly multi-date REQUEST would risk breaking that already-working code.
-- Instead:
--
--   venue_booking_request       — the request itself (AC1's "the request"):
--                                  one venue, one event, one submitter.
--   venue_booking_request_line  — each date/slot line within it (AC3): its
--                                  own status, independent of its siblings.
--
-- Only 'pending' exists for a line's status, the same pattern venue_booking's
-- own D-04 already uses ("only 'confirmed' exists until SCRUM-148 adds the
-- rest of the lifecycle"): this ticket only ever creates pending lines.
-- Deciding one is SCRUM-147-150's job (Venue Booking Approval), which may
-- widen this the same way SCRUM-92/93 widened event_request_status.
--
-- create_venue_booking_request() follows the transactional pattern from
-- 20260923120000_venue_save_in_one_transaction.sql: the request and every
-- one of its lines are written in one statement, so a failure partway
-- through never leaves an orphaned request with no lines.
-- =============================================================================

create table if not exists venue_booking_request (
  id uuid primary key default gen_random_uuid(),

  -- Restrict: a venue with pending requests against it is retired, not deleted.
  venue_id uuid not null references venues (id) on delete restrict,

  -- Cascade: a request belongs to its event and goes with it.
  event_request_id uuid not null references event_request (id) on delete cascade,

  -- The coordinator who submitted it (AC1/AC4). Restrict: deleting an
  -- account must not erase who requested what.
  requested_by uuid not null references auth.users (id) on delete restrict,

  created_at timestamptz not null default now()
);

create index if not exists venue_booking_request_event_idx
  on venue_booking_request (event_request_id);

-- Deny-all backstop, the same as every other table: server code reads and
-- writes through the service-role client and decides access in policy.ts.
alter table venue_booking_request enable row level security;


create table if not exists venue_booking_request_line (
  id uuid primary key default gen_random_uuid(),

  request_id uuid not null references venue_booking_request (id) on delete cascade,

  date date not null,

  -- Same rule as event_request's own time_slots (SCRUM-77,
  -- 20260911130000_event_request_time_slots.sql): one to three of AM/PM/
  -- Night, nothing else. Mandatory here, unlike event_request's nullable
  -- column, because a line without a slot is not a request for anything
  -- (AC1).
  time_slots text[] not null
    constraint venue_booking_request_line_slots_valid check (
      array_length(time_slots, 1) between 1 and 3
      and time_slots <@ array['am', 'pm', 'night']::text[]
    ),

  -- AC3: each line decided independently. Only 'pending' exists until
  -- SCRUM-147-150 adds the rest of the lifecycle — same pattern as
  -- venue_booking's own D-04.
  status text not null default 'pending'
    constraint venue_booking_request_line_status_known check (status in ('pending')),

  created_at timestamptz not null default now()
);

create index if not exists venue_booking_request_line_request_idx
  on venue_booking_request_line (request_id);

alter table venue_booking_request_line enable row level security;


-- -----------------------------------------------------------------------------
-- AC1, AC3 — create the request and every one of its lines in one
-- transaction. p_lines is a JSON array of {date, time_slots}. Returns the new
-- request's id.
-- -----------------------------------------------------------------------------
create or replace function create_venue_booking_request(
  p_event_request_id uuid,
  p_venue_id uuid,
  p_requested_by uuid,
  p_lines jsonb
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_request_id uuid;
begin
  insert into venue_booking_request (event_request_id, venue_id, requested_by)
  values (p_event_request_id, p_venue_id, p_requested_by)
  returning id into v_request_id;

  insert into venue_booking_request_line (request_id, date, time_slots)
  select
    v_request_id,
    (line ->> 'date')::date,
    array(select jsonb_array_elements_text(line -> 'time_slots'))
  from jsonb_array_elements(p_lines) as line;

  return v_request_id;
end;
$$;
