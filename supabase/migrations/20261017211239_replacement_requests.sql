-- =============================================================================
-- SCRUM-229 Request a replacement venue for an affected booking
-- =============================================================================
-- AC1: "Given my event has a booking flagged as affected, when I open the
--      event, then I can start a booking request for another venue with the
--      affected booking's date and start and end time filled in."
-- AC2: "Given the event is Confirmed, when I submit the replacement request,
--      then it is created and the event is not cancelled."
-- AC4: "Given the replacement request is approved, when I open the event,
--      then the affected booking shows as replaced and its outstanding action
--      is closed."
--
-- PO decision (Arwen, 12 Oct 2026): approving the replacement releases the
-- affected booking automatically, with SCRUM-231's release, so its outstanding
-- action closes (affected_booking_slot lists confirmed bookings only).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A replacement request names the booking it replaces (CONTEXT.md:
-- Replacement request). Null for an ordinary request. Whether the booking may
-- be replaced (this event's, confirmed, affected) is checked by the service,
-- which can name what is wrong.
-- -----------------------------------------------------------------------------

alter table venue_booking_request
  add column replaces_booking_id uuid references venue_booking (id) on delete set null;


-- -----------------------------------------------------------------------------
-- Creating a request saves the booking it replaces
--
-- Copied from SCRUM-230's 20261014114328_booking_request_venue_requirements.sql;
-- only the new argument is added. A new argument makes a new function in
-- Postgres, so the old one is dropped rather than left as a second way to
-- create a request.
-- -----------------------------------------------------------------------------

drop function if exists create_venue_booking_request(uuid, uuid, uuid, jsonb, integer, text, boolean, text);

create function create_venue_booking_request(
  p_event_request_id uuid,
  p_venue_id uuid,
  p_requested_by uuid,
  p_lines jsonb,
  p_expected_attendance integer default null,
  p_room_layout text default null,
  p_accessibility_required boolean default null,
  p_accessibility_notes text default null,
  p_replaces_booking_id uuid default null
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_request_id uuid;
begin
  insert into venue_booking_request (
    event_request_id, venue_id, requested_by,
    expected_attendance, room_layout, accessibility_required, accessibility_notes,
    replaces_booking_id
  )
  values (
    p_event_request_id, p_venue_id, p_requested_by,
    p_expected_attendance, p_room_layout, p_accessibility_required, p_accessibility_notes,
    p_replaces_booking_id
  )
  returning id into v_request_id;

  insert into venue_booking_request_line (request_id, date, start_time, end_time, time_slots)
  select
    v_request_id,
    (line ->> 'date')::date,
    (line ->> 'start')::time,
    (line ->> 'end')::time,
    case when line ? 'time_slots'
      then array(select jsonb_array_elements_text(line -> 'time_slots'))
    end
  from jsonb_array_elements(p_lines) as line;

  return v_request_id;
end;
$$;

-- Only the server may run it.
revoke all on function create_venue_booking_request(uuid, uuid, uuid, jsonb, integer, text, boolean, text, uuid)
  from public, anon, authenticated;
grant execute on function create_venue_booking_request(uuid, uuid, uuid, jsonb, integer, text, boolean, text, uuid)
  to service_role;


-- -----------------------------------------------------------------------------
-- AC4: an approved replacement releases the booking it replaces
--
-- SCRUM-148's approval writes one booking per approved line
-- (decide_venue_booking_request). When that line's request is a replacement,
-- the replaced booking is released in the same transaction, as SCRUM-231's
-- release records it: a reason, who released it and when. The coordinator who
-- asked for the replacement gave the booking up, so they are recorded as
-- releasing it (agreed 16 Oct 2026). Only a still-confirmed booking is
-- released, so a second approved line or replacement changes nothing.
--
-- A trigger, as SCRUM-227 closes holds (venue_booking_closes_holds), so
-- decide_venue_booking_request is unchanged.
-- -----------------------------------------------------------------------------

create or replace function release_replaced_booking() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'confirmed' and new.request_line_id is not null then
    update venue_booking replaced set
      status = 'released',
      release_reason = 'Replaced by ' || (select v.name from venues v where v.id = new.venue_id),
      released_by = r.requested_by,
      released_at = now()
    from venue_booking_request_line l
    join venue_booking_request r on r.id = l.request_id
    where l.id = new.request_line_id
      and replaced.id = r.replaces_booking_id
      and replaced.status = 'confirmed';
  end if;
  return null;
end;
$$;

create trigger venue_booking_releases_replaced after insert on venue_booking
  for each row execute function release_replaced_booking();
