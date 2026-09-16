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
-- Fires on any change to the note's text, not just null -> not-null. A
-- resubmitted request keeps its previous clarification_note rather than
-- clearing it (US-7.2 AC3 wants the history visible), so a *second*
-- clarification request overwrites an already-non-null note - the
-- null -> not-null guard this trigger shipped with would silently skip
-- re-stamping the timestamp on every round after the first, leaving
-- "Requested at" showing the first ask's time no matter how many followed it.
-- Confirmed live via manual testing on 2026-09-16, not just reasoned about.
create or replace function set_clarification_requested_at() returns trigger language plpgsql as $$
begin
  if new.clarification_note is not null and new.clarification_note is distinct from old.clarification_note then
    new.clarification_requested_at := now();
  end if;
  return new;
end;
$$;

create trigger event_request_set_clarification_requested_at
  before update of clarification_note on event_request
  for each row execute function set_clarification_requested_at();
