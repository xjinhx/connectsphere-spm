-- =============================================================================
-- SCRUM-92 — Approve a request so planning can proceed (AC1)
-- =============================================================================
-- AC1 records *when* the decision was made. The timestamp is stamped by the
-- database, not the caller, so it comes from one clock and cannot be faked by
-- whoever calls the API. This mirrors set_submitted_at(), which SCRUM-82 uses
-- for exactly the same reason.
--
-- Fires when a decision is first recorded, so SCRUM-93 gets it for 'rejected'
-- without adding a second trigger.

create or replace function set_decided_at() returns trigger language plpgsql as $$
begin
  if new.decision is not null and old.decision is null then
    new.decided_at := now();
  end if;
  return new;
end;
$$;

create trigger event_request_set_decided_at
  before update of decision on event_request
  for each row execute function set_decided_at();
