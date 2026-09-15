-- =============================================================================
-- SCRUM-96 - Reassign an event to another coordinator
-- =============================================================================
-- SCRUM-94 recorded who owns an event now, in three columns on event_request
-- (coordinator_id, assigned_by, assigned_at), and said a history table would
-- earn its place once reassignment existed. This is that story.
--
-- AC1: "the new assignee replaces the previous one". event_request keeps
--      holding the current owner, so SCRUM-94's queue (listMyAssignedEvents)
--      moves the event to the new coordinator with no further change.
-- AC3: "the previous assignment remains in the event's history". Each
--      assignment that gets replaced is copied here, with who replaced it,
--      with whom, and when.
--
-- Nothing SCRUM-94 created is altered. Its set_assigned_at trigger still stamps
-- the first assignment; the trigger below only acts when an existing
-- coordinator is swapped for a different one.
-- =============================================================================

create table if not exists event_request_coordinator_history (
  id uuid primary key default gen_random_uuid(),

  -- Cascade: history belongs to the event and goes with it.
  event_request_id uuid not null references event_request (id) on delete cascade,

  -- The assignment that was replaced, exactly as it stood.
  coordinator_id uuid not null references auth.users (id) on delete restrict,
  assigned_by uuid not null references auth.users (id) on delete restrict,
  assigned_at timestamptz not null,

  -- What replaced it. Restrict on every account reference, same as SCRUM-94:
  -- deleting an account must not quietly erase who did what.
  replaced_at timestamptz not null default now(),
  replaced_by uuid not null references auth.users (id) on delete restrict,
  replaced_by_coordinator_id uuid not null references auth.users (id) on delete restrict,

  -- A reassignment is always to somebody else (the service refuses a no-op).
  constraint event_request_coordinator_history_changes_owner
    check (replaced_by_coordinator_id <> coordinator_id)
);

-- AC3 reads an event's history in order.
create index if not exists event_request_coordinator_history_event_idx
  on event_request_coordinator_history (event_request_id, replaced_at);

-- Deny-all backstop, the same as every other table: server code reads and
-- writes through the service-role client and decides access in policy.ts.
alter table event_request_coordinator_history enable row level security;

-- -----------------------------------------------------------------------------
-- Record the history inside the same UPDATE as the reassignment.
--
-- supabase-js has no transactions. If the app wrote the history row and then
-- swapped the coordinator as two calls, a failure between them would leave a
-- history entry for a reassignment that never happened, or a reassignment
-- with no history. Doing both here means they succeed or fail together.
--
-- It also re-stamps assigned_at from the database clock, for the same reason
-- SCRUM-94 gave: a time supplied by the caller can be wrong or faked. The new
-- assigned_by is whoever the service recorded as making the change.
-- -----------------------------------------------------------------------------
create or replace function record_coordinator_reassignment() returns trigger language plpgsql as $$
begin
  if old.coordinator_id is not null
     and new.coordinator_id is not null
     and new.coordinator_id <> old.coordinator_id then
    insert into event_request_coordinator_history (
      event_request_id,
      coordinator_id,
      assigned_by,
      assigned_at,
      replaced_by,
      replaced_by_coordinator_id
    ) values (
      old.id,
      old.coordinator_id,
      old.assigned_by,
      old.assigned_at,
      new.assigned_by,
      new.coordinator_id
    );

    new.assigned_at := now();
  end if;
  return new;
end;
$$;

-- Fires before SCRUM-94's event_request_set_assigned_at (triggers run in name
-- order), and the two never both act: that one only handles unassigned to
-- assigned, this one only handles one coordinator to another.
create trigger event_request_record_coordinator_reassignment
  before update of coordinator_id on event_request
  for each row execute function record_coordinator_reassignment();
