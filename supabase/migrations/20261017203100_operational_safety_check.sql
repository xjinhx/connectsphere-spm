-- =============================================================================
-- SCRUM-234 — Run the Operational Safety Check
-- =============================================================================
-- AC3: approving records the decision, the Safety Officer and the time, and
--      moves the event from Confirmed to Preparation.
-- AC4: requesting changes records the note and returns the event to Planning.
-- AC5: rejecting records the reason and returns the event to Planning, not
--      Cancelled (customer clarification #130: it is revised and resubmitted).
-- AC6: Preparation is only reached through record_safety_check below. The
--      generic status change (changeEventStatus, SCRUM-103) refuses it, in
--      src/domain/event-status/policy.ts.
-- AC7: who may decide is checked in src/domain/safety-check/service.ts before
--      the call; RLS here is the deny-all backstop, and only the server may
--      run the function.
--
-- One row per decision, never updated: an event that goes back to Planning
-- and is confirmed again (AC1) gets a new check, and the earlier ones stay as
-- its history. The latest row is the one the coordinator sees (AC4, AC5).
-- =============================================================================

create table safety_check (
  id uuid primary key default gen_random_uuid(),
  event_request_id uuid not null references event_request (id) on delete cascade,
  decision text not null
    constraint safety_check_decision_known
      check (decision in ('approved', 'changes_requested', 'rejected')),
  -- AC4's note or AC5's reason. Not kept for an approval, required for the
  -- other two; the schema refuses a blank one first, with the message, and
  -- this is the backstop. 1000 characters, as the other free-text notes.
  note text
    constraint safety_check_note_length
      check (note is null or length(note) <= 1000),
  constraint safety_check_note_matches_decision check (
    case decision
      when 'approved' then note is null
      else note is not null and btrim(note) <> ''
    end
  ),
  -- AC3: who decided. Restrict, as decided_by elsewhere.
  decided_by uuid not null references auth.users (id) on delete restrict,
  decided_at timestamptz not null default now()
);

-- The event's checks, newest first.
create index safety_check_event_idx on safety_check (event_request_id, decided_at desc);

-- Deny-all backstop, the same as every other table.
alter table safety_check enable row level security;

-- -----------------------------------------------------------------------------
-- AC3-AC6: record the decision and move the event, in one transaction
-- -----------------------------------------------------------------------------
-- The event is locked first, so two decisions at once take turns: the second
-- finds it no longer Confirmed and nothing is recorded.
--
-- Returns 'recorded', or 'not_confirmed' when the event is not (or no longer)
-- Confirmed, in which case nothing changes. A note on an approval, or a blank
-- one on the other two, breaks safety_check_note_matches_decision and undoes
-- the status change too.
create function record_safety_check(
  p_event_request_id uuid,
  p_decision text,
  p_note text,
  p_decided_by uuid
) returns text
language plpgsql
set search_path = public
as $$
declare
  v_status event_request_status;
begin
  select status into v_status from event_request where id = p_event_request_id for update;

  if v_status is distinct from 'confirmed' then
    return 'not_confirmed';
  end if;

  insert into safety_check (event_request_id, decision, note, decided_by)
  values (p_event_request_id, p_decision, p_note, p_decided_by);

  update event_request
  set status = case p_decision when 'approved' then 'preparation' else 'planning' end::event_request_status,
      updated_at = now()
  where id = p_event_request_id;

  return 'recorded';
end;
$$;

-- Only the server may run it.
revoke all on function record_safety_check(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function record_safety_check(uuid, text, text, uuid) to service_role;
