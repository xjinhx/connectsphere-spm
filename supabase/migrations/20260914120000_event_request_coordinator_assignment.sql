-- =============================================================================
-- SCRUM-94 — Assign an Event Coordinator to a submitted event (AC1)
-- =============================================================================
-- AC1: "the assignment is recorded with my name and the assignment date".
-- Three columns on event_request rather than a coordinator_assignment table:
-- the card asks who owns an event now, never who has owned it before.
-- Reassignment (swapping one coordinator for another) has no acceptance
-- criterion on this card, and is where a history table would earn its place.
--
-- Deliberately the same shape as SCRUM-92's decision/decided_by/decided_at, so
-- one pattern covers every decision recorded against a request.
--
-- Not here, and not by accident: no workload limit (clarification #92 and AC2
-- allow a coordinator any number of events) and no accept/decline state
-- (clarification #95 - an assignment is simply true once made).

alter table event_request
  -- The event's internal owner. Points at auth.users like organiser_id and
  -- decided_by; restrict, because deleting an account must not quietly leave
  -- live events un-owned.
  add column coordinator_id uuid references auth.users (id) on delete restrict,
  -- AC1's "with my name" - the Event Operations Manager who made the call.
  add column assigned_by uuid references auth.users (id) on delete restrict,
  -- AC1's "and the assignment date". Stamped by the trigger below.
  add column assigned_at timestamptz;

-- The three columns are one fact: an event is either assigned, with a manager
-- and a date behind it, or it is not assigned at all.
alter table event_request
  add constraint event_request_assignment_complete check (
    (coordinator_id is null and assigned_by is null and assigned_at is null)
    or (coordinator_id is not null and assigned_by is not null and assigned_at is not null)
  );

-- AC1 assigns a *submitted* event. A draft has not been sent for review, so
-- there is nothing yet to own. Stated as "not a draft" rather than "is
-- submitted" so a later status (approved, and SCRUM-93's rejected) keeps its
-- assignment instead of breaking this constraint - the lesson from SCRUM-82's
-- submitted_at constraint, which had to be restated when 'approved' arrived.
alter table event_request
  add constraint event_request_assignment_needs_submission check (
    coordinator_id is null or status <> 'draft'
  );

-- One clock. Same reasoning as set_decided_at (SCRUM-92) and set_submitted_at
-- (SCRUM-82): a timestamp supplied by the caller can be wrong or faked.
-- Fires only when an event goes from unassigned to assigned, which is the only
-- move this story allows. A reassignment story would widen this.
create or replace function set_assigned_at() returns trigger language plpgsql as $$
begin
  if new.coordinator_id is not null and old.coordinator_id is null then
    new.assigned_at := now();
  end if;
  return new;
end;
$$;

create trigger event_request_set_assigned_at
  before update of coordinator_id on event_request
  for each row execute function set_assigned_at();

-- AC3 reads "the events assigned to me" on every coordinator page load.
create index event_request_coordinator_id_idx on event_request (coordinator_id);
