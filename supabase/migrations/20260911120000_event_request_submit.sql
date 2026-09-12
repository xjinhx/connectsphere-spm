-- =============================================================================
-- SCRUM-82 — Submit a completed event request
-- =============================================================================
-- Adds the draft/submitted split to the table created by SCRUM-76. Two values
-- only: the wider lifecycle (Event Status Management) is not in this sprint
-- and should extend the enum rather than replace it.

create type event_request_status as enum ('draft', 'submitted');

alter table event_request
  add column status event_request_status not null default 'draft',

  -- AC1: when the request was submitted. Stored as an instant (timestamptz)
  -- and rendered in Singapore time by the app, which is what "recorded in
  -- Singapore time" means for a value that must survive a server in any zone.
  add column submitted_at timestamptz,

  -- A submitted request always has a submission time, and a draft never does.
  add constraint event_request_submitted_at_matches_status check (
    (status = 'draft' and submitted_at is null)
    or (status = 'submitted' and submitted_at is not null)
  );

-- The submission time is stamped by the database, not the app, so it is
-- taken from one clock and cannot be set to anything else by the caller.
create or replace function set_submitted_at() returns trigger language plpgsql as $$
begin
  if old.status = 'draft' and new.status = 'submitted' then
    new.submitted_at := now();
  end if;
  return new;
end;
$$;

create trigger event_request_set_submitted_at
  before update of status on event_request
  for each row execute function set_submitted_at();

-- AC1: "appears in the Event Operations Manager's assignment queue". The queue
-- is every submitted request, oldest submission first. This index is what that
-- query reads; the queue itself is Coordinator Assignment's story.
create index event_request_assignment_queue
  on event_request (submitted_at)
  where status = 'submitted';