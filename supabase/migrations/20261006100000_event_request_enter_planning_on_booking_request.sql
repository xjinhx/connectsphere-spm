-- =============================================================================
-- SCRUM-101 — Move an event through its statuses (AC3, AC4)
-- =============================================================================
-- AC3: when the first venue booking request is raised against an Approved
--      event, the event becomes Planning.
-- AC4: when a further request is raised against an event already in Planning,
--      it stays Planning.
--
-- A trigger on venue_booking_request rather than a call from SCRUM-142's
-- submitVenueBookingRequest, so that ticket's code does not need to know this
-- one exists, and no other way of inserting a request can skip the move. Same
-- pattern as set_decided_at / set_clarification_requested_at. It runs in the
-- same transaction as the insert, so the request and the event's new status
-- land together or not at all.
--
-- The filter on status = 'approved' is the whole rule, and is what makes AC4
-- hold: an event already in Planning matches nothing, so nothing is rewritten
-- and no error is raised. The same rule lives in src/domain/event-status/
-- policy.ts (canEnterPlanning) for enterPlanning(), the direct call; it is
-- restated here because the database cannot import it.
--
-- Whether the request may be raised at all (assigned coordinator, event
-- Approved or Planning) is SCRUM-142's service check, made before the insert;
-- this trigger only reacts to a row that already exists.

create or replace function enter_planning_on_booking_request() returns trigger
language plpgsql
set search_path = public
as $$
begin
  update event_request
     set status = 'planning'
   where id = new.event_request_id
     and status = 'approved';
  return new;
end;
$$;

create trigger venue_booking_request_enter_planning
  after insert on venue_booking_request
  for each row execute function enter_planning_on_booking_request();
