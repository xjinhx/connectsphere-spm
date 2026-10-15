-- =============================================================================
-- SCRUM-230 Give each venue booking its own attendance and requirements
-- =============================================================================
-- AC1: "Given I am submitting a booking request, when I fill it in, then I can
--      enter the expected attendance, layout and accessibility needs for that
--      space."
-- AC2: "Given I leave them empty, when the request is created, then the
--      event's own attendance, layout and accessibility needs are used and
--      shown as the event's."
--
-- A request is for one venue, so its venue requirements (CONTEXT.md) sit on
-- the request, not on each line. Every column is nullable: empty means "use
-- the event's", read from the event when shown, so a later change to the event
-- flows through. Nothing is copied.
--
-- Accessibility is the event's answer and notes, without the feature list
-- (agreed 14 Oct 2026): NULL is "use the event's", false is "none for this
-- venue", true is "needed", with the notes saying what.
-- =============================================================================

alter table venue_booking_request
  add column expected_attendance integer
    check (expected_attendance > 0),
  -- The same seven layouts as event_request.room_layout (SCRUM-79).
  add column room_layout text
    check (room_layout in (
      'theatre',
      'classroom',
      'boardroom',
      'banquet',
      'u_shape',
      'cabaret',
      'standing'
    )),
  add column accessibility_required boolean,
  add column accessibility_notes text
    check (accessibility_notes is null or btrim(accessibility_notes) <> ''),
  -- As on the event: notes only go with a "needed" answer.
  add constraint venue_booking_request_accessibility_notes_need_requirement check (
    accessibility_required is true or accessibility_notes is null
  );


-- -----------------------------------------------------------------------------
-- Creating a request saves its venue requirements
--
-- Copied from SCRUM-239's 20261012090000_booking_requests_in_time_ranges.sql
-- (agreed with Yee Teng 14 Oct 2026). Its lines, times and time_slots are
-- unchanged; the four new arguments go into the request row and default to
-- NULL, so a caller that sends none gets a request that uses the event's.
-- A new argument makes a new function in Postgres, so the old one is dropped
-- rather than left as a second way to create a request.
-- -----------------------------------------------------------------------------

drop function if exists create_venue_booking_request(uuid, uuid, uuid, jsonb);

create function create_venue_booking_request(
  p_event_request_id uuid,
  p_venue_id uuid,
  p_requested_by uuid,
  p_lines jsonb,
  p_expected_attendance integer default null,
  p_room_layout text default null,
  p_accessibility_required boolean default null,
  p_accessibility_notes text default null
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_request_id uuid;
begin
  insert into venue_booking_request (
    event_request_id, venue_id, requested_by,
    expected_attendance, room_layout, accessibility_required, accessibility_notes
  )
  values (
    p_event_request_id, p_venue_id, p_requested_by,
    p_expected_attendance, p_room_layout, p_accessibility_required, p_accessibility_notes
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
revoke all on function create_venue_booking_request(uuid, uuid, uuid, jsonb, integer, text, boolean, text)
  from public, anon, authenticated;
grant execute on function create_venue_booking_request(uuid, uuid, uuid, jsonb, integer, text, boolean, text)
  to service_role;
