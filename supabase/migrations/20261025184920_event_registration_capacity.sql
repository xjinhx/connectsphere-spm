-- =============================================================================
-- SCRUM-182 — Refuse registration once the event is full
-- =============================================================================
-- "As an Attendee, I want registration refused once an event is full, so that
-- I am never given a place the venue cannot hold and I know immediately to
-- look elsewhere."
--
-- AC1: with the registration capacity reached, no registration is created and
--      the event is shown as full.
-- AC2: with one place left, two attendees submitting at the same moment:
--      exactly one succeeds, the other is refused as full.
-- AC3: a place released by a withdrawal can be registered for; there is no
--      waiting list in Release 1 (Sprint 4 Planning).
-- AC4: moved to epic SCRUM-52 (CL-32); not built.
--
-- Replaces SCRUM-181's stand-in (D-23, which always said places remain).
-- register_for_event (20261024130843_event_registration.sql) already calls
-- this function with the event row locked (FOR UPDATE), so two registrations
-- for the last place are counted one after the other (AC2): the second waits
-- for the first to commit, then counts it.
--
-- PO readings (Slack, 25/10/2026; on the SCRUM-182 card and the Change Log):
--   - no capacity set: refused the same way as a full event, since there is
--     nothing to count against (TC-182-02);
--   - capacity below the number registered: everyone stays registered, new
--     registrations are refused while the count is at or above the capacity,
--     and registration reopens only once it is below (TC-182-10).
--
-- Kept in step with isEventFull in src/domain/event-registration/policy.ts;
-- change one, change the other.
-- =============================================================================

create or replace function event_has_places_remaining(p_event_request_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  -- Only Registered rows take a place: a withdrawn one has given it back
  -- (AC3). A null capacity compares as null, which coalesce turns into "no
  -- places", as does an unknown event.
  select coalesce((
    select (
      select count(*)
      from event_registration r
      where r.event_request_id = e.id
        and r.status = 'registered'
    ) < e.registration_capacity
    from event_request e
    where e.id = p_event_request_id
  ), false);
$$;
