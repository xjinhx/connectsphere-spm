-- =============================================================================
-- SCRUM-270 — Bug against SCRUM-181 AC1: a Cancelled or Completed event still
-- accepted a registration
-- =============================================================================
-- register_for_event checked the period, the duplicate and places remaining,
-- but never the event's status, so a Cancelled or Completed event with its
-- period still open took registrations. PO, 28/10/2026: a registration period
-- is open only while the event is going ahead; both statuses are final.
--
-- Same function, same signature and grants; one check added, with the event
-- row locked like the others, so an event cancelled after the page loaded is
-- still refused. Returns 'cancelled' or 'completed'. Checked before the
-- period, the same order as registerForEvent.
--
-- Kept in step with finalEventStatus in src/domain/event-registration/policy.ts;
-- change one, change the other.
-- =============================================================================

create or replace function register_for_event(
  p_event_request_id uuid,
  p_attendee_id uuid,
  p_full_name text,
  p_email text,
  p_contact_number text,
  p_today date
) returns text
language plpgsql
set search_path = public
as $$
declare
  v_start date;
  v_end date;
  v_status text;
begin
  select registration_start_date, registration_end_date, status::text into v_start, v_end, v_status
  from event_request
  where id = p_event_request_id
  for update;

  if not found then
    return 'not_found';
  end if;

  if v_start is null then
    return 'not_open';
  end if;

  -- SCRUM-270: a Cancelled or Completed event takes no registrations,
  -- whatever its period says.
  if v_status in ('cancelled', 'completed') then
    return v_status;
  end if;

  -- AC2, AC3, AC4: both dates inclusive. Kept in step with
  -- registrationPeriodRefusal in src/domain/event-registration/policy.ts.
  if p_today < v_start then
    return 'not_started';
  end if;
  if p_today > v_end then
    return 'ended';
  end if;

  -- AC5.
  if exists (
    select 1 from event_registration
    where event_request_id = p_event_request_id
      and attendee_id = p_attendee_id
      and status = 'registered'
  ) then
    return 'already_registered';
  end if;

  -- AC1: places remain (SCRUM-182, event_has_places_remaining).
  if not event_has_places_remaining(p_event_request_id) then
    return 'full';
  end if;

  insert into event_registration (event_request_id, attendee_id, full_name, email, contact_number)
  values (p_event_request_id, p_attendee_id, btrim(p_full_name), btrim(p_email), btrim(p_contact_number));

  return 'registered';
exception
  -- The event row lock already orders two registrations for one event, so
  -- this is only a backstop for AC5.
  when unique_violation then
    return 'already_registered';
end;
$$;
