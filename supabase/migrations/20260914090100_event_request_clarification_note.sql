-- =============================================================================
-- SCRUM-90 — Request clarification from the Event Organiser (AC1)
-- =============================================================================
-- Step 2 of 2: record the note.
--
-- AC1: "the request status changes to Clarification Requested and the note is
-- retained with the event record." Column names deliberately separate from
-- decision/decided_by/decided_at (SCRUM-92): a clarification is not a decision,
-- and the two can coexist on the same row without one being mistaken for the
-- other in a query that only filters on `decision is not null`.

alter table event_request
  add column clarification_note text,
  -- Matches decided_by: restrict rather than cascade, so deleting an account
  -- cannot erase who asked for what.
  add column clarification_requested_by uuid references auth.users (id) on delete restrict,
  add column clarification_requested_at timestamptz;

-- AC3 enforced rather than assumed: requesting clarification without a note is
-- rejected before it reaches the database, but the constraint means it stays
-- impossible even from a query that bypasses the service layer.
alter table event_request
  add constraint event_request_clarification_requested_has_note
  check (status <> 'clarification_requested' or clarification_note is not null);

-- One fact in three columns: all recorded together, or none of them. Same
-- shape as event_request_decision_complete.
alter table event_request
  add constraint event_request_clarification_complete check (
    (clarification_note is null and clarification_requested_by is null and clarification_requested_at is null)
    or (clarification_note is not null and clarification_requested_by is not null and clarification_requested_at is not null)
  );

-- SCRUM-82's submitted_at rule already covers this status correctly
-- (clarification_requested <> draft, so it still requires a submitted_at) —
-- no change needed to event_request_submitted_at_matches_status.

-- Timestamp is stamped by the database, not the caller, matching
-- set_decided_at (20260912161500_event_request_decided_at_trigger.sql) for
-- exactly the same reason: one clock, and it cannot be faked by whoever calls
-- the API.
--
-- Keyed on the STATUS transition into clarification_requested, because that
-- is what "a clarification was raised" actually means. Two narrower guards
-- were tried first and both leaked:
--
--   1. `old.clarification_note is null` - only ever true for the first
--      clarification a request receives. The note is deliberately kept (never
--      cleared) when the Organiser resubmits, since US-7.2 AC3 wants the
--      history visible, so every later round wrote its note over a non-null
--      one and skipped the re-stamp entirely.
--   2. `new.clarification_note is distinct from old.clarification_note` -
--      closes that gap only when the wording changes. A Coordinator who asks
--      the SAME question again (the Organiser resubmitted without actually
--      answering it, so the identical sentence is re-sent) still produced no
--      re-stamp, while `status` and `clarification_requested_by` both updated
--      - leaving a row that says one Coordinator asked at another
--      Coordinator's timestamp.
--
-- The transition itself is unambiguous: requestClarification only ever moves a
-- request from submitted -> clarification_requested (markEventRequestClarificationRequested
-- filters on `status = 'submitted'`), so every genuine ask crosses this edge
-- exactly once, whatever the note says. `is distinct from` rather than
-- `old.status = 'submitted'` keeps it null-safe and reads like the sibling
-- triggers (set_submitted_at, set_assigned_at).
create or replace function set_clarification_requested_at() returns trigger language plpgsql as $$
begin
  if new.status = 'clarification_requested' and old.status is distinct from new.status then
    new.clarification_requested_at := now();
  end if;
  return new;
end;
$$;

-- `status` is in the column list as well as clarification_note: the body now
-- keys on status, so the trigger has to be woken by a status write even in the
-- (currently non-existent) case of one arriving without a note alongside it.
create trigger event_request_set_clarification_requested_at
  before update of clarification_note, status on event_request
  for each row execute function set_clarification_requested_at();
